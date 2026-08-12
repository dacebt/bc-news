import {
	COPYEDIT_SYSTEM_CONSTRAINTS, WRITER_SYSTEM_CONSTRAINTS, attachAnnouncementIds,
	announcementsFinalProductDiagnostics,
	buildAnnouncementsCopyeditPrompt, buildAnnouncementsWriterPrompt, buildMainStoryCopyeditPrompt, buildMainStoryWriterPrompt,
	mainStoryFinalProductDiagnostics,
	parseAnnouncementsCopyeditOutputWithDiagnostics, parseAnnouncementsWriterOutput,
	parseMainStoryCopyeditOutputWithDiagnostics, parseMainStoryWriterOutput,
	type AnnouncementsDraft, type AnnouncementsProduct, type MainStoryDraft, type MainStoryProduct,
	type EditorialDiagnostic,
	type ModelCompletion, type ModelProviderPort, type ModelProviderRequest, type ModelRuntimeEvidence, type PreparedEvidence, type ProductionModelStep,
} from "@bc-news/generation-core";
import {
	CloudflareAiGatewayRetryableError,
	LmStudioRetryableError,
	OpenAiCompatibleRetryableError,
} from "@bc-news/model-adapters";
import {
	V7BenchmarkRunSchema,
	V8BenchmarkRunSchema,
	type V7BenchmarkRun,
	type V7EvaluationTrial,
	type V8BenchmarkRun,
} from "./evaluation-artifact";
import { EvaluationArtifactStore } from "./evaluation-artifact-store";
import { deriveVersion5TrialOutcome } from "./evaluation-artifact-v5-trial-refinement";
import { parseFinding, sha256Json, terminalCurrentTrackOutcome, transportErrorIdentity } from "./evaluation-trial-support";

export class EvaluationRuntimeEvidenceError extends Error {
	readonly code = "evaluator_runtime_evidence_missing";
	constructor(productionStep: ProductionModelStep) {
		super(`Live provider returned no runtime evidence for ${productionStep}`);
		this.name = "EvaluationRuntimeEvidenceError";
	}
}

export function requireRuntimeEvidence(
	completion: ModelCompletion,
	productionStep: ProductionModelStep,
): ModelRuntimeEvidence {
	if (completion.runtime_evidence === undefined) throw new EvaluationRuntimeEvidenceError(productionStep);
	return completion.runtime_evidence;
}

export async function executeEvaluationTrial(input: {
	benchmark: V7BenchmarkRun | V8BenchmarkRun;
	store: EvaluationArtifactStore;
	preparedEvidence: PreparedEvidence;
	providers: Record<ProductionModelStep, ModelProviderPort>;
	configIdentity: string;
	trialId?: string;
	transportRetryLimit?: number;
}): Promise<V7BenchmarkRun | V8BenchmarkRun> {
	let benchmark = input.benchmark;
	const trialId = input.trialId ?? benchmark.trials[0]!.id;
	let mutationTail = Promise.resolve();
	let mutationFailed = false;
	let mutationFailure: unknown;

	function retainedTrial(retainedBenchmark: V7BenchmarkRun | V8BenchmarkRun): V7EvaluationTrial {
		const retained = retainedBenchmark.trials.find(({ id }) => id === trialId);
		if (retained === undefined || retainedBenchmark.trials.at(-1)?.id !== trialId) throw new Error(`Evaluation trial ${trialId} is not the final running trial`);
		return retained;
	}
	function enqueueMutation<T>(derive: (current: V7BenchmarkRun | V8BenchmarkRun) => { readonly next: V7BenchmarkRun | V8BenchmarkRun; readonly result: T }): Promise<T> {
		const operation = mutationTail.then(async () => {
			if (mutationFailed) throw mutationFailure;
			try {
				const mutation = derive(benchmark);
				const next = benchmark.version === 8
					? V8BenchmarkRunSchema.parse(mutation.next)
					: V7BenchmarkRunSchema.parse(mutation.next);
				await input.store.replace(next);
				benchmark = next;
				return mutation.result;
			} catch (error: unknown) {
				mutationFailed = true;
				mutationFailure = error;
				throw error;
			}
		});
		mutationTail = operation.then(() => undefined, () => undefined);
		return operation;
	}
	function updateTrial<T>(derive: (current: V7EvaluationTrial) => { readonly next: V7EvaluationTrial; readonly result: T }): Promise<T> {
		return enqueueMutation((currentBenchmark) => {
			const mutation = derive(retainedTrial(currentBenchmark));
			return {
				next: {
					...currentBenchmark,
					trials: currentBenchmark.trials.map((candidate) => candidate.id === trialId ? mutation.next : candidate),
				},
				result: mutation.result,
			};
		});
	}

	async function invoke<T extends Record<string, unknown>>(stepInput: {
		productionStep: ProductionModelStep; system: string; user: string; parse: (completion: ModelCompletion) => T;
	}): Promise<T | undefined> {
		const retainedRequest = { production_step: stepInput.productionStep, system: stepInput.system, user: stepInput.user };
		let predecessorInvocationId: string | null = null;
		let completion: ModelCompletion;
		for (let attempt = 0; ; attempt += 1) {
			const allocation = await enqueueMutation((currentBenchmark) => {
				const current = retainedTrial(currentBenchmark);
				const ordinal = current.invocations.length + 1;
				const invocationId = `${current.id}-invocation-${ordinal}`;
				const startedAt = new Date();
				const invocation = {
					id: invocationId, production_step: stepInput.productionStep, config_identity: input.configIdentity,
					ordinal, predecessor_invocation_id: predecessorInvocationId, request: retainedRequest, request_sha256: sha256Json(retainedRequest),
					started_at: startedAt.toISOString(), transport: "in_flight" as const, parse: { state: "pending" as const },
				};
				return {
					next: {
						...currentBenchmark,
						trials: currentBenchmark.trials.map((candidate) => candidate.id === trialId
							? { ...current, invocations: [...current.invocations, invocation] }
							: candidate),
						runtime_evidence: [...currentBenchmark.runtime_evidence, {
							trial_id: current.id,
							invocation_id: invocationId,
							config_identity: input.configIdentity,
							production_step: stepInput.productionStep,
							ordinal,
							state: "pending" as const,
						}],
						...(currentBenchmark.version === 8 ? { gateway_requests: [...currentBenchmark.gateway_requests, {
							trial_id: current.id,
							invocation_id: invocationId,
							config_identity: input.configIdentity,
							production_step: stepInput.productionStep,
							ordinal,
							state: "pending" as const,
						}] } : {}),
					},
					result: { invocationId, startedAt },
				};
			});
			const { invocationId, startedAt } = allocation;
			const request: ModelProviderRequest = {
				productionStep: stepInput.productionStep,
				system: stepInput.system,
				user: stepInput.user,
				correlation: { run_id: benchmark.id, invocation_id: invocationId },
			};
			try {
				completion = await input.providers[stepInput.productionStep].complete(request);
			}
			catch (error: unknown) {
				const endedAt = new Date();
				await enqueueMutation((currentBenchmark) => {
					const current = retainedTrial(currentBenchmark);
					return { next: {
						...currentBenchmark,
						trials: currentBenchmark.trials.map((trial) => trial.id === trialId ? { ...current, invocations: current.invocations.map((candidate) => candidate.id === invocationId ? {
							...candidate, transport: "failed" as const, failure: transportErrorIdentity(error), ended_at: endedAt.toISOString(),
							duration_ms: Math.max(0, endedAt.getTime() - startedAt.getTime()), retry_classification: { state: "pending" as const }, parse: { state: "pending" as const },
						} : candidate) } : trial),
						runtime_evidence: currentBenchmark.runtime_evidence.map((candidate) => candidate.invocation_id === invocationId ? {
							...candidate,
							state: "unavailable" as const,
							reason: "transport_failed" as const,
						} : candidate),
						...(currentBenchmark.version === 8 ? { gateway_requests: currentBenchmark.gateway_requests.map((candidate) => candidate.invocation_id === invocationId ? {
							...candidate,
							state: "unavailable" as const,
							reason: "transport_failed" as const,
						} : candidate) } : {}),
					}, result: undefined };
				});
				const eligible =
					error instanceof OpenAiCompatibleRetryableError
					|| error instanceof CloudflareAiGatewayRetryableError
					|| error instanceof LmStudioRetryableError;
				await updateTrial((current) => ({ next: { ...current, invocations: current.invocations.map((candidate) => candidate.id === invocationId && candidate.transport === "failed" ? {
					...candidate, retry_classification: { state: "classified" as const, eligible,
						reason: eligible ? "provider classified the transport failure as retryable" : "provider classified the transport failure as deterministic" },
				} : candidate) }, result: undefined }));
				if (!eligible || attempt >= (input.transportRetryLimit ?? 0)) return undefined;
				predecessorInvocationId = invocationId;
				continue;
			}

			const runtimeEvidence = requireRuntimeEvidence(completion, stepInput.productionStep);
			const retainedCompletion = {
				text: completion.text,
				provider: completion.provider,
				model: completion.model,
				execution: completion.execution,
				token_usage: completion.token_usage,
				external_billing: completion.external_billing,
			};
			const endedAt = new Date();
			await enqueueMutation((currentBenchmark) => {
				const current = retainedTrial(currentBenchmark);
				return { next: {
					...currentBenchmark,
					trials: currentBenchmark.trials.map((trial) => trial.id === trialId ? { ...current, invocations: current.invocations.map((candidate) => candidate.id === invocationId ? {
						...candidate, transport: "succeeded" as const, completion: retainedCompletion, ended_at: endedAt.toISOString(),
						duration_ms: Math.max(0, endedAt.getTime() - startedAt.getTime()), parse: { state: "pending" as const },
					} : candidate) } : trial),
					runtime_evidence: currentBenchmark.runtime_evidence.map((candidate) => candidate.invocation_id === invocationId ? {
						...candidate,
						state: "captured" as const,
						evidence: runtimeEvidence,
					} : candidate),
					...(currentBenchmark.version === 8 ? { gateway_requests: currentBenchmark.gateway_requests.map((candidate) => candidate.invocation_id === invocationId
						? completion.request_provenance === undefined
							? { ...candidate, state: "not_applicable" as const }
							: { ...candidate, state: "captured" as const, provenance: completion.request_provenance }
						: candidate) } : {}),
				}, result: undefined };
			});
			try {
				const output = stepInput.parse(completion);
				await updateTrial((current) => ({ next: { ...current, invocations: current.invocations.map((candidate) => candidate.id === invocationId && candidate.transport === "succeeded" ? {
					...candidate, parse: { state: "succeeded" as const, output },
				} : candidate), selected_invocation_ids: { ...current.selected_invocation_ids, [stepInput.productionStep]: invocationId } }, result: undefined }));
				return output;
			} catch (error: unknown) {
				const finding = parseFinding(error);
				if (finding === undefined) throw error;
				await updateTrial((current) => ({ next: { ...current, invocations: current.invocations.map((candidate) => candidate.id === invocationId && candidate.transport === "succeeded" ? {
					...candidate, parse: { state: "rejected" as const, findings: [finding] },
				} : candidate) }, result: undefined }));
				return undefined;
			}
		}
	}

	async function setTrack(track: "main_story" | "announcements", state: V7EvaluationTrial["tracks"][typeof track]): Promise<void> {
		await updateTrial((current) => ({ next: { ...current, tracks: { ...current.tracks, [track]: state } }, result: undefined }));
	}

	async function runMainStoryTrack(): Promise<void> {
		const mainDraft = await invoke<MainStoryDraft>({ productionStep: "main_story_write", system: WRITER_SYSTEM_CONSTRAINTS, user: buildMainStoryWriterPrompt(input.preparedEvidence), parse: ({ text }) => parseMainStoryWriterOutput(text) });
		let mainStory: MainStoryProduct | undefined;
		let mainDiagnostics: readonly EditorialDiagnostic[] = [];
		if (mainDraft !== undefined) mainStory = await invoke<MainStoryProduct>({ productionStep: "main_story_copyedit", system: COPYEDIT_SYSTEM_CONSTRAINTS, user: buildMainStoryCopyeditPrompt(mainDraft), parse: ({ text }) => {
			const parsed = parseMainStoryCopyeditOutputWithDiagnostics(text, mainDraft);
			mainDiagnostics = [...parsed.diagnostics, ...mainStoryFinalProductDiagnostics(parsed.product, input.preparedEvidence)];
			return parsed.product;
		} });
		if (mainStory === undefined) {
			await updateTrial((current) => ({ next: { ...current, tracks: { ...current.tracks, main_story: { ...current.tracks.main_story, lifecycle: "rejected", subject_outcome: terminalCurrentTrackOutcome(current, "main_story"), terminal_production_step: mainDraft === undefined ? "main_story_write" : "main_story_copyedit" } } }, result: undefined }));
		} else {
			await setTrack("main_story", { lifecycle: "completed", subject_outcome: "completed", terminal_production_step: "main_story_copyedit", product: mainStory, findings: [...mainDiagnostics] });
		}
	}

	async function runAnnouncementsTrack(): Promise<void> {
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
			await updateTrial((current) => ({ next: { ...current, tracks: { ...current.tracks, announcements: { ...current.tracks.announcements, lifecycle: "rejected", subject_outcome: terminalCurrentTrackOutcome(current, "announcements"), terminal_production_step: announcementsDraft === undefined ? "announcements_write" : "announcements_copyedit" } } }, result: undefined }));
		} else {
			await setTrack("announcements", { lifecycle: "completed", subject_outcome: "completed", terminal_production_step: "announcements_copyedit", product: announcements, findings: [...announcementDiagnostics] });
		}
	}

	await updateTrial((current) => ({ next: {
		...current,
		tracks: {
			main_story: { ...current.tracks.main_story, lifecycle: "running" },
			announcements: { ...current.tracks.announcements, lifecycle: "running" },
		},
	}, result: undefined }));
	const trackResults = await Promise.allSettled([runMainStoryTrack(), runAnnouncementsTrack()]);
	const failures: unknown[] = [];
	for (const result of trackResults) {
		if (result.status === "rejected") failures.push(result.reason as unknown);
	}
	if (failures.length === 1) throw failures[0];
	if (failures.length === 2) throw new AggregateError(failures, `Both evaluation tracks failed for ${trialId}`);

	await enqueueMutation((current) => {
		const currentTrial = retainedTrial(current);
		const outcome = deriveVersion5TrialOutcome(currentTrial);
		const completedAt = new Date().toISOString();
		const counts = { ...current.outcome_counts };
		counts[outcome] += 1;
		const completedTrial = { ...currentTrial, lifecycle: "complete" as const, completed_at: completedAt, subject_outcome: outcome };
		return { next: { ...current,
			trials: current.trials.map((candidate) => candidate.id === trialId ? completedTrial : candidate), outcome_counts: counts }, result: undefined };
	});
	return benchmark;
}
