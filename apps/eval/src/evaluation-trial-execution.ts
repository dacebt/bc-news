import {
	COPYEDIT_SYSTEM_CONSTRAINTS, WRITER_SYSTEM_CONSTRAINTS, attachAnnouncementIds,
	announcementsFinalProductDiagnostics,
	buildAnnouncementsCopyeditPrompt, buildAnnouncementsWriterPrompt, buildMainStoryCopyeditPrompt, buildMainStoryWriterPrompt,
	mainStoryFinalProductDiagnostics,
	parseAnnouncementsCopyeditOutputWithDiagnostics, parseAnnouncementsWriterOutput,
	parseMainStoryCopyeditOutputWithDiagnostics, parseMainStoryWriterOutput,
	type AnnouncementsDraft, type AnnouncementsProduct, type MainStoryDraft, type MainStoryProduct,
	type EditorialDiagnostic,
	type ModelCompletion, type ModelProviderPort, type ModelProviderRequest, type PreparedEvidence, type ProductionModelStep,
} from "@bc-news/generation-core";
import {
	LmStudioRetryableError,
	OpenAiCompatibleRetryableError,
} from "@bc-news/model-adapters";
import { V5BenchmarkRunSchema, type V5BenchmarkRun, type V5EvaluationTrial } from "./evaluation-artifact";
import { EvaluationArtifactStore } from "./evaluation-artifact-store";
import { deriveVersion5TrialOutcome } from "./evaluation-artifact-v5-trial-refinement";
import { parseFinding, sha256Json, terminalVersion5TrackOutcome, transportErrorIdentity } from "./evaluation-trial-support";

export async function executeEvaluationTrial(input: {
	benchmark: V5BenchmarkRun;
	store: EvaluationArtifactStore;
	preparedEvidence: PreparedEvidence;
	providers: Record<ProductionModelStep, ModelProviderPort>;
	configIdentity: string;
	trialId?: string;
	transportRetryLimit?: number;
}): Promise<V5BenchmarkRun> {
	let benchmark = input.benchmark;
	async function retain(next: V5BenchmarkRun): Promise<void> { await input.store.replace(next); benchmark = next; }
	const trialId = input.trialId ?? benchmark.trials[0]!.id;
	function trial(): V5EvaluationTrial {
		const retained = benchmark.trials.find(({ id }) => id === trialId);
		if (retained === undefined || benchmark.trials.at(-1)?.id !== trialId) throw new Error(`Evaluation trial ${trialId} is not the final running trial`);
		return retained;
	}
	async function updateTrial(nextTrial: V5EvaluationTrial): Promise<void> {
		await retain(V5BenchmarkRunSchema.parse({ ...benchmark, trials: benchmark.trials.map((candidate) => candidate.id === trialId ? nextTrial : candidate) }));
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

	async function setTrack(track: "main_story" | "announcements", state: V5EvaluationTrial["tracks"][typeof track]): Promise<void> {
		await updateTrial({ ...trial(), tracks: { ...trial().tracks, [track]: state } });
	}

	await setTrack("main_story", { ...trial().tracks.main_story, lifecycle: "running" });
	const mainDraft = await invoke<MainStoryDraft>({ productionStep: "main_story_write", system: WRITER_SYSTEM_CONSTRAINTS, user: buildMainStoryWriterPrompt(input.preparedEvidence), parse: ({ text }) => parseMainStoryWriterOutput(text) });
	let mainStory: MainStoryProduct | undefined;
	let mainDiagnostics: readonly EditorialDiagnostic[] = [];
	if (mainDraft !== undefined) mainStory = await invoke<MainStoryProduct>({ productionStep: "main_story_copyedit", system: COPYEDIT_SYSTEM_CONSTRAINTS, user: buildMainStoryCopyeditPrompt(mainDraft), parse: ({ text }) => {
		const parsed = parseMainStoryCopyeditOutputWithDiagnostics(text, mainDraft);
		mainDiagnostics = [...parsed.diagnostics, ...mainStoryFinalProductDiagnostics(parsed.product, input.preparedEvidence)];
		return parsed.product;
	} });
	if (mainStory === undefined) {
		await setTrack("main_story", { ...trial().tracks.main_story, lifecycle: "rejected", subject_outcome: terminalVersion5TrackOutcome(trial(), "main_story"), terminal_production_step: mainDraft === undefined ? "main_story_write" : "main_story_copyedit" });
	} else {
		await setTrack("main_story", { lifecycle: "completed", subject_outcome: "completed", terminal_production_step: "main_story_copyedit", product: mainStory, findings: [...mainDiagnostics] });
	}

	await setTrack("announcements", { ...trial().tracks.announcements, lifecycle: "running" });
	const announcementsDraft = await invoke<AnnouncementsDraft>({ productionStep: "announcements_write", system: WRITER_SYSTEM_CONSTRAINTS, user: buildAnnouncementsWriterPrompt(input.preparedEvidence), parse: ({ text }) => parseAnnouncementsWriterOutput(text) });
	let announcements: AnnouncementsProduct | undefined;
	let announcementDiagnostics: readonly EditorialDiagnostic[] = [];
	if (announcementsDraft !== undefined) {
		const identified = attachAnnouncementIds(announcementsDraft);
		announcements = await invoke<AnnouncementsProduct>({ productionStep: "announcements_copyedit", system: COPYEDIT_SYSTEM_CONSTRAINTS, user: buildAnnouncementsCopyeditPrompt(identified), parse: ({ text }) => {
			const parsed = parseAnnouncementsCopyeditOutputWithDiagnostics(text, identified);
			announcementDiagnostics = [...parsed.diagnostics, ...announcementsFinalProductDiagnostics(parsed.product, input.preparedEvidence)];
			return parsed.product;
		} });
	}
	if (announcements === undefined) {
		await setTrack("announcements", { ...trial().tracks.announcements, lifecycle: "rejected", subject_outcome: terminalVersion5TrackOutcome(trial(), "announcements"), terminal_production_step: announcementsDraft === undefined ? "announcements_write" : "announcements_copyedit" });
	} else {
		await setTrack("announcements", { lifecycle: "completed", subject_outcome: "completed", terminal_production_step: "announcements_copyedit", product: announcements, findings: [...announcementDiagnostics] });
	}

	const outcome = deriveVersion5TrialOutcome(trial());
	const completedAt = new Date().toISOString();
	const counts = { ...benchmark.outcome_counts }; counts[outcome] += 1;
	const completedTrial = { ...trial(), lifecycle: "complete" as const, completed_at: completedAt, subject_outcome: outcome };
	await retain(V5BenchmarkRunSchema.parse({ ...benchmark,
		trials: benchmark.trials.map((candidate) => candidate.id === trialId ? completedTrial : candidate), outcome_counts: counts }));
	return benchmark;
}
