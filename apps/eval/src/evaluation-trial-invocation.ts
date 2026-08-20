import {
	CloudflareAiGatewayRetryableError,
	LmStudioRetryableError,
	OpenAiCompatibleRetryableError,
} from "@bc-news/model-adapters";
import type {
	ModelCompletion,
	ModelProviderPort,
	ModelProviderRequest,
	ModelRuntimeEvidence,
} from "@bc-news/generation-core";
import type { CurrentProductionModelStep } from "./current-production-steps";
import type { TrialMutationController } from "./evaluation-trial-mutation";
import {
	parseFinding,
	sha256Json,
	transportErrorIdentity,
} from "./evaluation-trial-support";

function retryableTransportFailure(error: unknown): boolean {
	return (
		error instanceof OpenAiCompatibleRetryableError ||
		error instanceof CloudflareAiGatewayRetryableError ||
		error instanceof LmStudioRetryableError
	);
}

function retainedCompletion(completion: ModelCompletion) {
	return {
		text: completion.text,
		provider: completion.provider,
		model: completion.model,
		execution: completion.execution,
		token_usage: completion.token_usage,
		external_billing: completion.external_billing,
	};
}

export async function invokeTrialStep<T extends Record<string, unknown>>(input: {
	mutation: TrialMutationController;
	benchmarkId: string;
	configIdentity: string;
	providers: Record<CurrentProductionModelStep, ModelProviderPort>;
	transportRetryLimit: number | undefined;
	productionStep: CurrentProductionModelStep;
	system: string;
	user: string;
	parse: (completion: ModelCompletion) => T;
	requireRuntimeEvidence: (
		completion: ModelCompletion,
		productionStep: CurrentProductionModelStep,
	) => ModelRuntimeEvidence;
}): Promise<T | undefined> {
	const retainedRequest = {
		production_step: input.productionStep,
		system: input.system,
		user: input.user,
	};
	let predecessorInvocationId: string | null = null;
	let completion: ModelCompletion;
	for (let attempt = 0; ; attempt += 1) {
		const allocation = await input.mutation.enqueueMutation((currentBenchmark) => {
			const current = input.mutation.retainedTrial(currentBenchmark);
			const ordinal = current.invocations.length + 1;
			const invocationId = `${current.id}-invocation-${ordinal}`;
			const startedAt = new Date();
			const identity = {
				trial_id: current.id,
				invocation_id: invocationId,
				config_identity: input.configIdentity,
				production_step: input.productionStep,
				ordinal,
			};
			return {
				next: {
					...currentBenchmark,
					trials: currentBenchmark.trials.map((candidate) =>
						candidate.id === input.mutation.trialId
							? {
									...current,
									invocations: [
										...current.invocations,
										{
											id: invocationId,
											production_step: input.productionStep,
											config_identity: input.configIdentity,
											ordinal,
											predecessor_invocation_id: predecessorInvocationId,
											request: retainedRequest,
											request_sha256: sha256Json(retainedRequest),
											started_at: startedAt.toISOString(),
											transport: "in_flight" as const,
											parse: { state: "pending" as const },
										},
									],
							  }
							: candidate,
					),
					runtime_evidence: [
						...currentBenchmark.runtime_evidence,
						{ ...identity, state: "pending" as const },
					],
					gateway_requests: [
						...currentBenchmark.gateway_requests,
						{ ...identity, state: "pending" as const },
					],
				},
				result: { invocationId, startedAt },
			};
		});
		const { invocationId, startedAt } = allocation;
		const request: ModelProviderRequest = {
			productionStep: input.productionStep,
			system: input.system,
			user: input.user,
			correlation: { run_id: input.benchmarkId, invocation_id: invocationId },
		};
		try {
			completion = await input.providers[input.productionStep].complete(request);
		} catch (error: unknown) {
			const endedAt = new Date();
			await input.mutation.enqueueMutation((currentBenchmark) => {
				const current = input.mutation.retainedTrial(currentBenchmark);
				return {
					next: {
						...currentBenchmark,
						trials: currentBenchmark.trials.map((trial) =>
							trial.id === input.mutation.trialId
								? {
										...current,
										invocations: current.invocations.map((candidate) =>
											candidate.id === invocationId
												? {
														...candidate,
														transport: "failed" as const,
														failure: transportErrorIdentity(error),
														ended_at: endedAt.toISOString(),
														duration_ms: Math.max(
															0,
															endedAt.getTime() - startedAt.getTime(),
														),
														retry_classification: {
															state: "pending" as const,
														},
														parse: { state: "pending" as const },
												  }
												: candidate,
										),
								  }
								: trial,
						),
						runtime_evidence: currentBenchmark.runtime_evidence.map((candidate) =>
							candidate.invocation_id === invocationId
								? {
										...candidate,
										state: "unavailable" as const,
										reason: "transport_failed" as const,
								  }
								: candidate,
						),
						gateway_requests: currentBenchmark.gateway_requests.map((candidate) =>
							candidate.invocation_id === invocationId
								? {
										...candidate,
										state: "unavailable" as const,
										reason: "transport_failed" as const,
								  }
								: candidate,
						),
					},
					result: undefined,
				};
			});
			const eligible = retryableTransportFailure(error);
			await input.mutation.updateTrial((current) => ({
				next: {
					...current,
					invocations: current.invocations.map((candidate) =>
						candidate.id === invocationId && candidate.transport === "failed"
							? {
									...candidate,
									retry_classification: {
										state: "classified" as const,
										eligible,
										reason: eligible
											? "provider classified the transport failure as retryable"
											: "provider classified the transport failure as deterministic",
									},
							  }
							: candidate,
					),
				},
				result: undefined,
			}));
			if (!eligible || attempt >= (input.transportRetryLimit ?? 0)) {
				return undefined;
			}
			predecessorInvocationId = invocationId;
			continue;
		}

		const runtimeEvidence = input.requireRuntimeEvidence(
			completion,
			input.productionStep,
		);
		const endedAt = new Date();
		await input.mutation.enqueueMutation((currentBenchmark) => {
			const current = input.mutation.retainedTrial(currentBenchmark);
			return {
				next: {
					...currentBenchmark,
					trials: currentBenchmark.trials.map((trial) =>
						trial.id === input.mutation.trialId
							? {
									...current,
									invocations: current.invocations.map((candidate) =>
										candidate.id === invocationId
											? {
													...candidate,
													transport: "succeeded" as const,
													completion: retainedCompletion(completion),
													ended_at: endedAt.toISOString(),
													duration_ms: Math.max(
														0,
														endedAt.getTime() - startedAt.getTime(),
													),
													parse: { state: "pending" as const },
											  }
											: candidate,
									),
							  }
							: trial,
					),
					runtime_evidence: currentBenchmark.runtime_evidence.map((candidate) =>
						candidate.invocation_id === invocationId
							? {
									...candidate,
									state: "captured" as const,
									evidence: runtimeEvidence,
							  }
							: candidate,
					),
					gateway_requests: currentBenchmark.gateway_requests.map((candidate) =>
						candidate.invocation_id === invocationId
							? completion.request_provenance === undefined
								? { ...candidate, state: "not_applicable" as const }
								: {
										...candidate,
										state: "captured" as const,
										provenance: completion.request_provenance,
								  }
							: candidate,
					),
				},
				result: undefined,
			};
		});
		try {
			const output = input.parse(completion);
			await input.mutation.updateTrial((current) => ({
				next: {
					...current,
					invocations: current.invocations.map((candidate) =>
						candidate.id === invocationId &&
						candidate.transport === "succeeded"
							? {
									...candidate,
									parse: { state: "succeeded" as const, output },
							  }
							: candidate,
					),
					selected_invocation_ids: {
						...current.selected_invocation_ids,
						[input.productionStep]: invocationId,
					},
				},
				result: undefined,
			}));
			return output;
		} catch (error: unknown) {
			const finding = parseFinding(error);
			if (finding === undefined) {
				throw error;
			}
			await input.mutation.updateTrial((current) => ({
				next: {
					...current,
					invocations: current.invocations.map((candidate) =>
						candidate.id === invocationId &&
						candidate.transport === "succeeded"
							? {
									...candidate,
									parse: { state: "rejected" as const, findings: [finding] },
							  }
							: candidate,
					),
				},
				result: undefined,
			}));
			return undefined;
		}
	}
}
