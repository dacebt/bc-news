import {
	COPYEDIT_SYSTEM_CONSTRAINTS, WRITER_SYSTEM_CONSTRAINTS, attachAnnouncementIds,
	buildAnnouncementsCopyeditPrompt, buildAnnouncementsWriterPrompt, buildMainStoryCopyeditPrompt, buildMainStoryWriterPrompt,
	parseAnnouncementsCopyeditOutput, parseAnnouncementsWriterOutput, parseMainStoryCopyeditOutput, parseMainStoryWriterOutput,
	type AnnouncementsDraft, type AnnouncementsProduct, type MainStoryDraft, type MainStoryProduct,
	type ModelCompletion, type ModelProviderPort, type ModelProviderRequest, type PreparedEvidence, type ProductionModelStep,
} from "@bc-news/generation-core";
import {
	LmStudioRetryableError,
	OpenAiCompatibleRetryableError,
} from "@bc-news/model-adapters";
import { BenchmarkRunSchema, deriveEvaluationTrialOutcome, type BenchmarkRun, type EvaluationFinding, type EvaluationTrial } from "./evaluation-artifact";
import { EvaluationArtifactStore } from "./evaluation-artifact-store";
import { findAnnouncementsFinalProductFailures, findMainStoryFinalProductFailures } from "./product-checks";
import { parseFinding, sha256Json, terminalTrackOutcome, transportErrorIdentity } from "./evaluation-trial-support";

export async function executeEvaluationTrial(input: {
	benchmark: BenchmarkRun;
	store: EvaluationArtifactStore;
	preparedEvidence: PreparedEvidence;
	providers: Record<ProductionModelStep, ModelProviderPort>;
	configIdentity: string;
	trialId?: string;
	transportRetryLimit?: number;
}): Promise<BenchmarkRun> {
	let benchmark = input.benchmark;
	async function retain(next: BenchmarkRun): Promise<void> { await input.store.replace(next); benchmark = next; }
	const trialId = input.trialId ?? benchmark.trials[0]!.id;
	function trial(): EvaluationTrial {
		const retained = benchmark.trials.find(({ id }) => id === trialId);
		if (retained === undefined || benchmark.trials.at(-1)?.id !== trialId) throw new Error(`Evaluation trial ${trialId} is not the final running trial`);
		return retained;
	}
	async function updateTrial(nextTrial: EvaluationTrial): Promise<void> {
		await retain(BenchmarkRunSchema.parse({ ...benchmark, trials: benchmark.trials.map((candidate) => candidate.id === trialId ? nextTrial : candidate) }));
	}

	async function invoke<T extends Record<string, unknown>>(stepInput: {
		productionStep: ProductionModelStep; system: string; user: string; parse: (completion: ModelCompletion) => T;
	}): Promise<T | undefined> {
		const request: ModelProviderRequest = { productionStep: stepInput.productionStep, system: stepInput.system, user: stepInput.user };
		const retainedRequest = { production_step: stepInput.productionStep, system: stepInput.system, user: stepInput.user };
		let predecessorInvocationId: string | null = null;
		let completion: ModelCompletion;
		for (let attempt = 0; ; attempt += 1) {
			const ordinal = trial().invocations.length + 1;
			const invocationId = `${trial().id}-invocation-${ordinal}`;
			const startedAt = new Date();
			await updateTrial({ ...trial(), invocations: [...trial().invocations, {
				id: invocationId, production_step: stepInput.productionStep, config_identity: input.configIdentity,
				ordinal, predecessor_invocation_id: predecessorInvocationId, request: retainedRequest, request_sha256: sha256Json(retainedRequest),
				started_at: startedAt.toISOString(), transport: "in_flight", parse: { state: "pending" },
			}] });
			try { completion = await input.providers[stepInput.productionStep].complete(request); }
			catch (error: unknown) {
				const endedAt = new Date();
				await updateTrial({ ...trial(), invocations: trial().invocations.map((candidate) => candidate.id === invocationId ? {
					...candidate, transport: "failed" as const, failure: transportErrorIdentity(error), ended_at: endedAt.toISOString(),
					duration_ms: Math.max(0, endedAt.getTime() - startedAt.getTime()), retry_classification: { state: "pending" as const }, parse: { state: "pending" as const },
				} : candidate) });
				const eligible =
					error instanceof OpenAiCompatibleRetryableError
					|| error instanceof LmStudioRetryableError;
				await updateTrial({ ...trial(), invocations: trial().invocations.map((candidate) => candidate.id === invocationId && candidate.transport === "failed" ? {
					...candidate, retry_classification: { state: "classified" as const, eligible,
						reason: eligible ? "provider classified the transport failure as retryable" : "provider classified the transport failure as deterministic" },
				} : candidate) });
				if (!eligible || attempt >= (input.transportRetryLimit ?? 0)) return undefined;
				predecessorInvocationId = invocationId;
				continue;
			}

			const endedAt = new Date();
			await updateTrial({ ...trial(), invocations: trial().invocations.map((candidate) => candidate.id === invocationId ? {
			...candidate, transport: "succeeded" as const, completion, ended_at: endedAt.toISOString(),
			duration_ms: Math.max(0, endedAt.getTime() - startedAt.getTime()), parse: { state: "pending" as const },
			} : candidate) });
			try {
				const output = stepInput.parse(completion);
				await updateTrial({ ...trial(), invocations: trial().invocations.map((candidate) => candidate.id === invocationId && candidate.transport === "succeeded" ? {
				...candidate, parse: { state: "succeeded" as const, output },
				} : candidate), selected_invocation_ids: { ...trial().selected_invocation_ids, [stepInput.productionStep]: invocationId } });
				return output;
			} catch (error: unknown) {
				const finding = parseFinding(error);
				if (finding === undefined) throw error;
				await updateTrial({ ...trial(), invocations: trial().invocations.map((candidate) => candidate.id === invocationId && candidate.transport === "succeeded" ? {
				...candidate, parse: { state: "rejected" as const, findings: [finding] },
				} : candidate) });
				return undefined;
			}
		}
	}

	async function setTrack(track: "main_story" | "announcements", state: EvaluationTrial["tracks"][typeof track]): Promise<void> {
		await updateTrial({ ...trial(), tracks: { ...trial().tracks, [track]: state } });
	}

	await setTrack("main_story", { ...trial().tracks.main_story, lifecycle: "running" });
	const mainDraft = await invoke<MainStoryDraft>({ productionStep: "main_story_write", system: WRITER_SYSTEM_CONSTRAINTS, user: buildMainStoryWriterPrompt(input.preparedEvidence), parse: ({ text }) => parseMainStoryWriterOutput(text) });
	let mainStory: MainStoryProduct | undefined;
	if (mainDraft !== undefined) mainStory = await invoke<MainStoryProduct>({ productionStep: "main_story_copyedit", system: COPYEDIT_SYSTEM_CONSTRAINTS, user: buildMainStoryCopyeditPrompt(mainDraft), parse: ({ text }) => parseMainStoryCopyeditOutput(text, mainDraft) });
	if (mainStory === undefined) {
		await setTrack("main_story", { ...trial().tracks.main_story, lifecycle: "rejected", subject_outcome: terminalTrackOutcome(trial(), "main_story", []), terminal_production_step: mainDraft === undefined ? "main_story_write" : "main_story_copyedit" });
	} else {
		const findings = findMainStoryFinalProductFailures(mainStory, input.preparedEvidence).map((message, index): EvaluationFinding => ({ kind: "final_product", production_step: "main_story_copyedit", code: `final_product_${index + 1}`, message }));
		await setTrack("main_story", { lifecycle: findings.length === 0 ? "completed" : "rejected", subject_outcome: terminalTrackOutcome(trial(), "main_story", findings), terminal_production_step: "main_story_copyedit", product: mainStory, findings });
	}

	await setTrack("announcements", { ...trial().tracks.announcements, lifecycle: "running" });
	const announcementsDraft = await invoke<AnnouncementsDraft>({ productionStep: "announcements_write", system: WRITER_SYSTEM_CONSTRAINTS, user: buildAnnouncementsWriterPrompt(input.preparedEvidence), parse: ({ text }) => parseAnnouncementsWriterOutput(text) });
	let announcements: AnnouncementsProduct | undefined;
	if (announcementsDraft !== undefined) {
		const identified = attachAnnouncementIds(announcementsDraft);
		announcements = await invoke<AnnouncementsProduct>({ productionStep: "announcements_copyedit", system: COPYEDIT_SYSTEM_CONSTRAINTS, user: buildAnnouncementsCopyeditPrompt(identified), parse: ({ text }) => parseAnnouncementsCopyeditOutput(text, identified) });
	}
	if (announcements === undefined) {
		await setTrack("announcements", { ...trial().tracks.announcements, lifecycle: "rejected", subject_outcome: terminalTrackOutcome(trial(), "announcements", []), terminal_production_step: announcementsDraft === undefined ? "announcements_write" : "announcements_copyedit" });
	} else {
		const findings = findAnnouncementsFinalProductFailures(announcements, input.preparedEvidence).map((message, index): EvaluationFinding => ({ kind: "final_product", production_step: "announcements_copyedit", code: `final_product_${index + 1}`, message }));
		await setTrack("announcements", { lifecycle: findings.length === 0 ? "completed" : "rejected", subject_outcome: terminalTrackOutcome(trial(), "announcements", findings), terminal_production_step: "announcements_copyedit", product: announcements, findings });
	}

	const outcome = deriveEvaluationTrialOutcome(trial());
	const completedAt = new Date().toISOString();
	const counts = { ...benchmark.outcome_counts }; counts[outcome] += 1;
	const completedTrial = { ...trial(), lifecycle: "complete" as const, completed_at: completedAt, subject_outcome: outcome };
	if (benchmark.version === 1) {
		await retain(BenchmarkRunSchema.parse({ ...benchmark, lifecycle: "complete", completed_at: completedAt,
			trials: [completedTrial], outcome_counts: counts, harness_outcome: "retained" }));
	} else {
		await retain(BenchmarkRunSchema.parse({ ...benchmark,
			trials: benchmark.trials.map((candidate) => candidate.id === trialId ? completedTrial : candidate), outcome_counts: counts }));
	}
	return benchmark;
}
