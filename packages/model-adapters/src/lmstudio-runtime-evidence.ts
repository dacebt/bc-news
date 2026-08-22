import type { LLM, LLMPredictionStats, PredictionResult } from "@lmstudio/sdk";
import {
	observedMeasurement,
	observedNonnegativeInteger,
	observedPositiveInteger,
	observedString,
	type AppliedInferenceConfiguration,
	type ModelRuntimeEvidence,
	type ModelRuntimeIdentity,
	type RuntimeNonnegativeIntegerObservation,
} from "@bc-news/generation-core";
import type { LmStudioReasoningEffort } from "./config";
import { LM_STUDIO_SDK_RELEASE } from "./lmstudio-sdk-release";

export type LmStudioAuxiliaryObservation<T> =
	| { readonly state: "succeeded"; readonly value: T }
	| { readonly state: "failed" };

export const LM_STUDIO_AUXILIARY_OBSERVATION_TIMEOUT_MS = 1_000;

export async function observeLmStudioAuxiliary<T>(
	operation: () => Promise<T>,
): Promise<LmStudioAuxiliaryObservation<T>> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			Promise.resolve().then(operation).then(
				(value) => ({ state: "succeeded" as const, value }),
				() => ({ state: "failed" as const }),
			),
			new Promise<LmStudioAuxiliaryObservation<T>>((resolve) => {
				timeout = setTimeout(
					() => resolve({ state: "failed" }),
					LM_STUDIO_AUXILIARY_OBSERVATION_TIMEOUT_MS,
				);
			}),
		]);
	} finally {
		if (timeout !== undefined) clearTimeout(timeout);
	}
}

function unavailableString(reason: "observation_failed" | "not_reported" | "not_applicable") {
	return { state: "unknown" as const, reason };
}

function unavailableInteger(reason: "observation_failed" | "not_reported" | "not_applicable") {
	return { state: "unknown" as const, reason };
}

function unavailableMeasurement(reason: "observation_failed" | "not_reported" | "not_applicable") {
	return { state: "unknown" as const, reason };
}

function unavailableBoolean(reason: "observation_failed" | "not_reported" | "not_applicable") {
	return { state: "unknown" as const, reason };
}

function selectedModelIdentity(
	model: LLM,
	requestedModel: string,
	info: LmStudioAuxiliaryObservation<Awaited<ReturnType<LLM["getModelInfo"]>>>,
): ModelRuntimeIdentity {
	return {
		requested_identity: observedString(requestedModel),
		identifier: observedString(model.identifier),
		model_key: observedString(model.modelKey),
		path: observedString(model.path),
		display_name: observedString(model.displayName),
		format: observedString(model.format),
		instance_reference: info.state === "failed"
			? unavailableString("observation_failed")
			: observedString(info.value.instanceReference),
		size_bytes: observedNonnegativeInteger(model.sizeBytes),
		architecture: info.state === "failed"
			? unavailableString("observation_failed")
			: observedString(info.value.architecture),
		parameter_count_description: info.state === "failed"
			? unavailableString("observation_failed")
			: observedString(info.value.paramsString),
		quantization_name: info.state === "failed"
			? unavailableString("observation_failed")
			: observedString(info.value.quantization?.name),
		quantization_bits: info.state === "failed"
			? unavailableMeasurement("observation_failed")
			: observedMeasurement(info.value.quantization?.bits),
		vision_capable: { state: "observed", value: model.vision },
		trained_for_tool_use: { state: "observed", value: model.trainedForToolUse },
	};
}

function responseModelIdentity(result: PredictionResult, requestedModel: string): ModelRuntimeIdentity {
	return {
		requested_identity: observedString(requestedModel),
		identifier: observedString(result.modelInfo.identifier),
		model_key: observedString(result.modelInfo.modelKey),
		path: observedString(result.modelInfo.path),
		display_name: observedString(result.modelInfo.displayName),
		format: observedString(result.modelInfo.format),
		instance_reference: observedString(result.modelInfo.instanceReference),
		size_bytes: observedNonnegativeInteger(result.modelInfo.sizeBytes),
		architecture: observedString(result.modelInfo.architecture),
		parameter_count_description: observedString(result.modelInfo.paramsString),
		quantization_name: observedString(result.modelInfo.quantization?.name),
		quantization_bits: observedMeasurement(result.modelInfo.quantization?.bits),
		vision_capable: typeof result.modelInfo.vision === "boolean"
			? { state: "observed", value: result.modelInfo.vision }
			: unavailableBoolean("not_reported"),
		trained_for_tool_use: typeof result.modelInfo.trainedForToolUse === "boolean"
			? { state: "observed", value: result.modelInfo.trainedForToolUse }
			: unavailableBoolean("not_reported"),
	};
}

function speculativeCounts(stats: LLMPredictionStats): {
	readonly total: RuntimeNonnegativeIntegerObservation;
	readonly accepted: RuntimeNonnegativeIntegerObservation;
	readonly rejected: RuntimeNonnegativeIntegerObservation;
	readonly ignored: RuntimeNonnegativeIntegerObservation;
} {
	const values = [
		stats.totalDraftTokensCount,
		stats.acceptedDraftTokensCount,
		stats.rejectedDraftTokensCount,
		stats.ignoredDraftTokensCount,
	] as const;
	const parsed = values.map(observedNonnegativeInteger);
	const [total, accepted, rejected, ignored] = parsed;
	if (total?.state === "observed"
		&& accepted?.state === "observed"
		&& rejected?.state === "observed"
		&& ignored?.state === "observed"
		&& total.value === accepted.value + rejected.value + ignored.value) {
		return { total, accepted, rejected, ignored };
	}
	const unknown = unavailableInteger("not_reported");
	return { total: unknown, accepted: unknown, rejected: unknown, ignored: unknown };
}

export function lmStudioRuntimeEvidence(input: {
	readonly result: PredictionResult;
	readonly model: LLM;
	readonly requestedModel: string;
	readonly reasoningEffort: LmStudioReasoningEffort;
	readonly enableThinking: boolean | undefined;
	readonly appliedInferenceConfiguration: AppliedInferenceConfiguration;
	readonly version: LmStudioAuxiliaryObservation<{ readonly version: string; readonly build: number }>;
	readonly modelInfo: LmStudioAuxiliaryObservation<Awaited<ReturnType<LLM["getModelInfo"]>>>;
	readonly contextLength: LmStudioAuxiliaryObservation<number>;
}): ModelRuntimeEvidence {
	const speculative = speculativeCounts(input.result.stats);
	return {
		execution_context: {
			client_sdk_release: { state: "observed", value: LM_STUDIO_SDK_RELEASE },
			provider_runtime_identity: { state: "unknown", reason: "not_reported" },
			provider_runtime_version: input.version.state === "failed"
				? unavailableString("observation_failed")
				: observedString(input.version.value.version),
			provider_runtime_build: input.version.state === "failed"
				? unavailableInteger("observation_failed")
				: observedNonnegativeInteger(input.version.value.build),
			provider_service_tier: { state: "unknown", reason: "not_applicable" },
			selected_model: selectedModelIdentity(input.model, input.requestedModel, input.modelInfo),
			response_model: responseModelIdentity(input.result, input.requestedModel),
			context_length: input.contextLength.state === "failed"
				? { state: "unknown", reason: "observation_failed" }
				: observedPositiveInteger(input.contextLength.value),
			requested_reasoning_posture: observedString(input.enableThinking === undefined
				? input.reasoningEffort
				: input.enableThinking ? "thinking_enabled" : "thinking_disabled"),
			effective_reasoning_setting: input.appliedInferenceConfiguration.thinking_enabled.state === "observed"
				? observedString(input.appliedInferenceConfiguration.thinking_enabled.value
					? "thinking_enabled"
					: "thinking_disabled")
				: { state: "externally_controlled", reason: "provider_controlled" },
			speculative_draft_model_identity: observedString(input.result.stats.usedDraftModelKey),
			applied_inference_configuration: input.appliedInferenceConfiguration,
		},
		prediction_observation: {
			provider_response_id: { state: "unknown", reason: "not_applicable" },
			stop_reason: observedString(input.result.stats.stopReason),
			time_to_first_token_ms: observedMeasurement(
				typeof input.result.stats.timeToFirstTokenSec === "number"
					? input.result.stats.timeToFirstTokenSec * 1_000
					: undefined,
			),
			total_time_ms: observedMeasurement(
				typeof input.result.stats.totalTimeSec === "number"
					? input.result.stats.totalTimeSec * 1_000
					: undefined,
			),
			tokens_per_second: observedMeasurement(input.result.stats.tokensPerSecond),
			speculative_total_tokens: speculative.total,
			speculative_accepted_tokens: speculative.accepted,
			speculative_rejected_tokens: speculative.rejected,
			speculative_ignored_tokens: speculative.ignored,
			reasoning_content_present: { state: "observed", value: input.result.reasoningContent.length > 0 },
		},
	};
}
