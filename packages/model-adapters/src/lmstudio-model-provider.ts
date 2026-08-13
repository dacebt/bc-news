import { LMStudioClient, type LLM, type LLMPredictionStats, type PredictionResult } from "@lmstudio/sdk";
import type {
	ModelCompletion,
	ModelRuntimeEvidence,
	ModelProviderPort,
	ModelProviderRequest,
	ProductionModelStep,
} from "@bc-news/generation-core";
import type { LmStudioReasoningEffort, ModelTemperature } from "./config";
import { lmStudioSdkBaseUrl } from "./lmstudio-base-url";
import {
	LmStudioDeterministicError,
	LmStudioRetryableError,
} from "./lmstudio-errors";
import type { ProductionStepOutputContracts } from "./production-step-output-contracts";
import { lmStudioRuntimeEvidence, observeLmStudioAuxiliary } from "./lmstudio-runtime-evidence";

const COMPLETION_TIMEOUT_MS = 1_800_000;
const SUCCESSFUL_STOP_REASONS = new Set(["eosFound", "stopStringFound"]);

export interface LmStudioProviderInput {
	readonly baseUrl: string;
	readonly requestedModel: string;
	readonly temperature?: ModelTemperature;
	readonly reasoningEffort: LmStudioReasoningEffort;
	readonly structuredOutputContracts: ProductionStepOutputContracts;
}

export interface LmStudioPredictionRequestInput {
	readonly productionStep: ProductionModelStep;
	readonly system: string;
	readonly user: string;
	readonly temperature?: ModelTemperature;
	readonly structuredOutputContracts: ProductionStepOutputContracts;
}

type LmStudioTemperaturePredictionOption =
	| { readonly temperature: number }
	| { readonly temperature?: never };

export interface LmStudioPredictionRequest {
	readonly chat: [
		{ readonly role: "system"; readonly content: string },
		{ readonly role: "user"; readonly content: string },
	];
	readonly options: LmStudioTemperaturePredictionOption & {
		readonly structured: {
			readonly type: "json";
			readonly jsonSchema: Readonly<Record<string, unknown>>;
		};
	};
}

export function buildLmStudioPredictionRequest(
	input: LmStudioPredictionRequestInput,
): LmStudioPredictionRequest {
	const contract = input.structuredOutputContracts[input.productionStep];
	const temperatureOption: LmStudioTemperaturePredictionOption = input.temperature === undefined
		? {}
		: { temperature: input.temperature };
	return {
		chat: [
			{ role: "system" as const, content: input.system },
			{ role: "user" as const, content: input.user },
		],
		options: {
			...temperatureOption,
			structured: { type: "json" as const, jsonSchema: contract.schema },
		},
	};
}

function loadedModelIdentity(model: LLM): readonly string[] {
	return [model.identifier, model.modelKey, model.path, model.displayName];
}

function resolveLoadedModel(models: readonly LLM[], requestedModel: string): LLM {
	const matches = models.filter((model) => loadedModelIdentity(model).includes(requestedModel));
	if (matches.length === 0) {
		throw new LmStudioDeterministicError(
			"lmstudio_loaded_model_not_found",
			`LM Studio model "${requestedModel}" is not already loaded`,
		);
	}
	if (matches.length > 1) {
		throw new LmStudioDeterministicError(
			"lmstudio_loaded_model_ambiguous",
			`LM Studio model "${requestedModel}" matches multiple loaded models`,
		);
	}
	const match = matches[0];
	if (match === undefined) {
		throw new LmStudioDeterministicError(
			"lmstudio_loaded_model_not_found",
			`LM Studio model "${requestedModel}" is not already loaded`,
		);
	}
	return match;
}

function tokenUsage(stats: LLMPredictionStats): ModelCompletion["token_usage"] {
	const counts = [
		stats.promptTokensCount,
		stats.predictedTokensCount,
		stats.totalTokensCount,
	] as const;
	if (counts.every((count) => count === undefined)) {
		return { measurement: "unavailable" };
	}
	const valid = counts.every(
		(count) => typeof count === "number" && Number.isFinite(count) && Number.isInteger(count) && count >= 0,
	);
	if (!valid) {
		throw new LmStudioDeterministicError(
			"lmstudio_usage_contract_rejected",
			"LM Studio returned partial or invalid token usage",
		);
	}
	const [inputTokens, outputTokens, totalTokens] = counts as readonly [number, number, number];
	if (totalTokens !== inputTokens + outputTokens) {
		throw new LmStudioDeterministicError(
			"lmstudio_usage_contract_rejected",
			"LM Studio returned inconsistent token usage",
		);
	}
	return {
		measurement: "reported",
		input_tokens: inputTokens,
		output_tokens: outputTokens,
		total_tokens: totalTokens,
	};
}

function completionFromResult(input: {
	readonly result: PredictionResult;
	readonly timeoutFired: boolean;
	readonly evidence: ModelRuntimeEvidence;
}): ModelCompletion {
	const { result, timeoutFired } = input;
	if (timeoutFired) {
		throw new LmStudioRetryableError(
			"lmstudio_timeout",
			"LM Studio completion timed out",
		);
	}
	if (!SUCCESSFUL_STOP_REASONS.has(result.stats.stopReason)) {
		if (["userStopped", "modelUnloaded", "failed"].includes(result.stats.stopReason)) {
			throw new LmStudioRetryableError(
				"lmstudio_sdk_failure",
				`LM Studio completion stopped with ${result.stats.stopReason}`,
			);
		}
		throw new LmStudioDeterministicError(
			"lmstudio_completion_incomplete",
			`LM Studio completion stopped with ${result.stats.stopReason}`,
		);
	}
	if (result.modelInfo.identifier.trim() === "") {
		throw new LmStudioDeterministicError(
			"lmstudio_response_contract_rejected",
			"LM Studio completion model identity must be nonblank",
		);
	}
	return {
		text: result.nonReasoningContent,
		provider: "lmstudio",
		model: result.modelInfo.identifier,
		execution: "local_inference",
		token_usage: tokenUsage(result.stats),
		external_billing: { classification: "none", amount_usd: 0, reason: "local_inference" },
		runtime_evidence: input.evidence,
	};
}

type LmStudioClassifiedError = LmStudioDeterministicError | LmStudioRetryableError;

function classifySdkFailure(cause: unknown): LmStudioClassifiedError {
	if (cause instanceof LmStudioDeterministicError || cause instanceof LmStudioRetryableError) {
		return cause;
	}
	return new LmStudioRetryableError(
		"lmstudio_sdk_failure",
		"LM Studio SDK operation failed",
		{ cause },
	);
}

async function disposeClient(client: LMStudioClient): Promise<LmStudioClassifiedError | undefined> {
	try {
		await client[Symbol.asyncDispose]();
		return undefined;
	} catch (cause) {
		return classifySdkFailure(cause);
	}
}

function combineOperationAndDisposalFailures(
	operationFailure: LmStudioClassifiedError,
	disposalFailure: LmStudioClassifiedError,
): LmStudioClassifiedError {
	const options = { cause: new AggregateError([operationFailure, disposalFailure]) };
	if (operationFailure instanceof LmStudioDeterministicError) {
		return new LmStudioDeterministicError(
			operationFailure.code,
			operationFailure.message,
			options,
		);
	}
	return new LmStudioRetryableError(
		operationFailure.code,
		operationFailure.message,
		options,
	);
}

export function createLmStudioModelProvider(input: LmStudioProviderInput): ModelProviderPort {
	const baseUrl = lmStudioSdkBaseUrl(input.baseUrl);
	if (input.requestedModel.trim() === "") {
		throw new LmStudioDeterministicError(
			"lmstudio_invalid_config",
			"LM Studio requested model must be nonblank",
		);
	}
	if (input.reasoningEffort !== "provider_default") {
		throw new LmStudioDeterministicError(
			"lmstudio_invalid_config",
			"LM Studio native inference supports only provider_default reasoning effort",
		);
	}

	return {
		async complete(request: ModelProviderRequest) {
			let client: LMStudioClient;
			try {
				client = new LMStudioClient({ baseUrl });
			} catch (cause) {
				throw classifySdkFailure(cause);
			}

			let completion: ModelCompletion | undefined;
			let operationFailure: LmStudioClassifiedError | undefined;
			try {
				const model = resolveLoadedModel(await client.llm.listLoaded(), input.requestedModel);
				const versionObservation = observeLmStudioAuxiliary(() => client.system.getLMStudioVersion());
				const modelInfoObservation = observeLmStudioAuxiliary(() => model.getModelInfo());
				const contextLengthObservation = observeLmStudioAuxiliary(() => model.getContextLength());
				const controller = new AbortController();
				let timeoutFired = false;
				const timeout = setTimeout(() => {
					timeoutFired = true;
					controller.abort();
				}, COMPLETION_TIMEOUT_MS);
				try {
					const predictionRequest = buildLmStudioPredictionRequest({
						productionStep: request.productionStep,
						system: request.system,
						user: request.user,
						...(input.temperature === undefined ? {} : { temperature: input.temperature }),
						structuredOutputContracts: input.structuredOutputContracts,
					});
					const result = await model.respond(
						predictionRequest.chat,
						{
							...predictionRequest.options,
							signal: controller.signal,
						},
					).catch((cause: unknown) => {
						if (timeoutFired) {
							throw new LmStudioRetryableError(
								"lmstudio_timeout",
								"LM Studio completion timed out",
								{ cause },
							);
						}
						throw cause;
					});
					completion = completionFromResult({
						result,
						timeoutFired,
						evidence: lmStudioRuntimeEvidence({
							result,
							model,
							requestedModel: input.requestedModel,
							reasoningEffort: input.reasoningEffort,
							version: await versionObservation,
							modelInfo: await modelInfoObservation,
							contextLength: await contextLengthObservation,
						}),
					});
				} finally {
					clearTimeout(timeout);
				}
			} catch (cause) {
				operationFailure = classifySdkFailure(cause);
			}

			const disposalFailure = await disposeClient(client);
			if (disposalFailure !== undefined) {
				if (operationFailure !== undefined) {
					throw combineOperationAndDisposalFailures(operationFailure, disposalFailure);
				}
				throw disposalFailure;
			}
			if (operationFailure !== undefined) {
				throw operationFailure;
			}
			if (completion === undefined) {
				throw new LmStudioRetryableError(
					"lmstudio_sdk_failure",
					"LM Studio SDK operation ended without a completion",
				);
			}
			return completion;
		},
	};
}
