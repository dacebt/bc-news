import type { KVConfig, PredictionResult } from "@lmstudio/sdk";
import {
	observedMeasurement,
	observedPositiveInteger,
	type AppliedInferenceConfiguration,
} from "@bc-news/generation-core";
import type { LmStudioInferenceConfig } from "./lmstudio-model-provider";
import { LmStudioDeterministicError } from "./lmstudio-errors";

const CONFIG_KEYS = {
	temperature: "llm.prediction.temperature",
	topP: "llm.prediction.topPSampling",
	topK: "llm.prediction.topKSampling",
	thinking: "llm.prediction.reasoning.enableThinking",
} as const;

interface AppliedLmStudioInferenceConfig {
	readonly temperature: number | undefined;
	readonly topP: number | undefined;
	readonly topK: number | undefined;
	readonly enableThinking: boolean | undefined;
}

function responseContractRejected(message: string): never {
	throw new LmStudioDeterministicError("lmstudio_response_contract_rejected", message);
}

function fieldValue(config: KVConfig, key: string): unknown {
	const matches = config.fields.filter((field) => field.key === key);
	if (matches.length > 1) responseContractRejected(`LM Studio returned duplicate prediction config field ${key}`);
	return matches[0]?.value;
}

function optionalNumber(value: unknown, key: string): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "number" || !Number.isFinite(value)) {
		responseContractRejected(`LM Studio returned invalid prediction config field ${key}`);
	}
	return value;
}

function optionalPositiveInteger(value: unknown, key: string): number | undefined {
	const parsed = optionalNumber(value, key);
	if (parsed !== undefined && (!Number.isInteger(parsed) || parsed < 1)) {
		responseContractRejected(`LM Studio returned invalid prediction config field ${key}`);
	}
	return parsed;
}

function optionalTopP(value: unknown): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "number") return optionalNumber(value, CONFIG_KEYS.topP);
	if (typeof value !== "object" || value === null || !("checked" in value) || !("value" in value)) {
		responseContractRejected(`LM Studio returned invalid prediction config field ${CONFIG_KEYS.topP}`);
	}
	const checkbox = value as { readonly checked: unknown; readonly value: unknown };
	if (typeof checkbox.checked !== "boolean") {
		responseContractRejected(`LM Studio returned invalid prediction config field ${CONFIG_KEYS.topP}`);
	}
	return checkbox.checked ? optionalNumber(checkbox.value, CONFIG_KEYS.topP) : undefined;
}

function optionalBoolean(value: unknown, key: string): boolean | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "boolean") {
		responseContractRejected(`LM Studio returned invalid prediction config field ${key}`);
	}
	return value;
}

function appliedConfig(result: PredictionResult): AppliedLmStudioInferenceConfig {
	const config = result.predictionConfig;
	if (config === undefined || !Array.isArray(config.fields)) {
		responseContractRejected("LM Studio returned no usable prediction config receipt");
	}
	return {
		temperature: optionalNumber(fieldValue(config, CONFIG_KEYS.temperature), CONFIG_KEYS.temperature),
		topP: optionalTopP(fieldValue(config, CONFIG_KEYS.topP)),
		topK: optionalPositiveInteger(fieldValue(config, CONFIG_KEYS.topK), CONFIG_KEYS.topK),
		enableThinking: optionalBoolean(fieldValue(config, CONFIG_KEYS.thinking), CONFIG_KEYS.thinking),
	};
}

function requireMatch(name: string, requested: number | boolean | undefined, applied: number | boolean | undefined): void {
	if (requested === undefined || Object.is(requested, applied)) return;
	throw new LmStudioDeterministicError(
		"lmstudio_prediction_config_mismatch",
		`LM Studio applied ${name}=${String(applied)} instead of requested ${name}=${String(requested)}`,
	);
}

export function confirmLmStudioPredictionConfig(
	result: PredictionResult,
	requested: LmStudioInferenceConfig,
): AppliedInferenceConfiguration {
	const applied = appliedConfig(result);
	requireMatch("temperature", requested.temperature, applied.temperature);
	requireMatch("top_p", requested.topP, applied.topP);
	requireMatch("top_k", requested.topK, applied.topK);
	requireMatch("enable_thinking", requested.enableThinking, applied.enableThinking);
	return {
		temperature: observedMeasurement(applied.temperature),
		top_p: observedMeasurement(applied.topP),
		top_k: observedPositiveInteger(applied.topK),
		thinking_enabled: applied.enableThinking === undefined
			? { state: "unknown", reason: "not_reported" }
			: { state: "observed", value: applied.enableThinking },
	};
}
