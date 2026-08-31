import {
	type WalkExecution,
	type WalkExternalBilling,
	type WalkGatewayLogId,
	type WalkModelAttemptUsageRecord,
	type WalkRequestCorrelation,
	type WalkRequestProvenance,
	type WalkTokenUsage,
} from "./generation-run-status-types";
import { hasExactKeys, isRecord } from "./generation-run-status-guards";

type WalkModelUsageFieldsWithoutStep = Omit<WalkModelAttemptUsageRecord, "production_step">;

function isExecution(value: unknown): value is WalkExecution {
	return value === "recorded_replay" || value === "local_inference" || value === "hosted_inference";
}

function isNonnegativeFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function parseTokenUsage(value: unknown, body: string): WalkTokenUsage {
	if (!isRecord(value) || typeof value["measurement"] !== "string") {
		throw new Error(`generation run operator status has invalid token usage: ${body}`);
	}
	if (value["measurement"] === "unavailable" && hasExactKeys(value, ["measurement"])) {
		return { measurement: "unavailable" };
	}
	const inputTokens = value["input_tokens"];
	const outputTokens = value["output_tokens"];
	const totalTokens = value["total_tokens"];
	if (
		value["measurement"] !== "reported" ||
		!hasExactKeys(value, ["measurement", "input_tokens", "output_tokens", "total_tokens"]) ||
		!isNonnegativeFiniteNumber(inputTokens) ||
		!Number.isInteger(inputTokens) ||
		!isNonnegativeFiniteNumber(outputTokens) ||
		!Number.isInteger(outputTokens) ||
		!isNonnegativeFiniteNumber(totalTokens) ||
		!Number.isInteger(totalTokens) ||
		totalTokens !== inputTokens + outputTokens
	) {
		throw new Error(`generation run operator status has invalid token usage: ${body}`);
	}
	return {
		measurement: "reported",
		input_tokens: inputTokens,
		output_tokens: outputTokens,
		total_tokens: totalTokens,
	};
}

export function parseExternalBilling(value: unknown, body: string): WalkExternalBilling {
	if (!isRecord(value)) {
		throw new Error(`generation run operator status has invalid external billing: ${body}`);
	}
	if (
		value["classification"] === "none" &&
		hasExactKeys(value, ["classification", "amount_usd", "reason"]) &&
		value["amount_usd"] === 0 &&
		(value["reason"] === "recorded_replay" || value["reason"] === "local_inference")
	) {
		return { classification: "none", amount_usd: 0, reason: value["reason"] };
	}
	if (
		value["classification"] === "provider_reported" &&
		hasExactKeys(value, ["classification", "amount_usd"]) &&
		isNonnegativeFiniteNumber(value["amount_usd"])
	) {
		return { classification: "provider_reported", amount_usd: value["amount_usd"] };
	}
	if (
		value["classification"] === "calculated" &&
		hasExactKeys(value, ["classification", "amount_usd", "pricing_reference"]) &&
		isNonnegativeFiniteNumber(value["amount_usd"]) &&
		typeof value["pricing_reference"] === "string" &&
		value["pricing_reference"].trim().length > 0
	) {
		return {
			classification: "calculated",
			amount_usd: value["amount_usd"],
			pricing_reference: value["pricing_reference"],
		};
	}
	if (
		value["classification"] === "unavailable" &&
		hasExactKeys(value, ["classification", "reason"]) &&
		value["reason"] === "provider_did_not_report_cost"
	) {
		return { classification: "unavailable", reason: "provider_did_not_report_cost" };
	}
	throw new Error(`generation run operator status has invalid external billing: ${body}`);
}

function parseRequestCorrelation(value: unknown, body: string): WalkRequestCorrelation {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ["run_id", "invocation_id"]) ||
		typeof value["run_id"] !== "string" ||
		value["run_id"].trim().length === 0 ||
		typeof value["invocation_id"] !== "string" ||
		value["invocation_id"].trim().length === 0
	) {
		throw new Error(`generation run operator status has invalid request provenance: ${body}`);
	}
	return { run_id: value["run_id"], invocation_id: value["invocation_id"] };
}

function parseGateway(value: unknown, body: string): WalkRequestProvenance["gateway"] {
	if (!isRecord(value) || typeof value["selection"] !== "string") {
		throw new Error(`generation run operator status has invalid request provenance: ${body}`);
	}
	if (value["selection"] === "account_default" && hasExactKeys(value, ["selection"])) {
		return { selection: "account_default" };
	}
	if (
		value["selection"] === "named" &&
		hasExactKeys(value, ["selection", "id"]) &&
		typeof value["id"] === "string" &&
		value["id"].trim().length > 0
	) {
		return { selection: "named", id: value["id"] };
	}
	throw new Error(`generation run operator status has invalid request provenance: ${body}`);
}

function parseGatewayLogId(value: unknown, body: string): WalkGatewayLogId {
	if (typeof value === "string" && value.trim().length > 0) return value;
	if (
		isRecord(value) &&
		hasExactKeys(value, ["state", "reason"]) &&
		value["state"] === "unavailable" &&
		value["reason"] === "provider_did_not_report"
	) {
		return { state: "unavailable", reason: "provider_did_not_report" };
	}
	throw new Error(`generation run operator status has invalid request provenance: ${body}`);
}

function parseRequestPolicy(value: unknown, body: string): WalkRequestProvenance["policy"] {
	if (!isRecord(value)) {
		throw new Error(`generation run operator status has invalid request provenance: ${body}`);
	}
	const policyKeys = Object.keys(value).sort();
	const basicKeys = ["cache", "log_metadata", "log_payload", "max_attempts", "request_timeout_ms"];
	const extendedKeys = [...basicKeys, "request_format", "response_delivery", "structured_output"].sort();
	if (
		JSON.stringify(policyKeys) !== JSON.stringify(basicKeys) &&
		JSON.stringify(policyKeys) !== JSON.stringify(extendedKeys)
	) {
		throw new Error(`generation run operator status has invalid request provenance: ${body}`);
	}
	if (
		value["cache"] !== "bypass" ||
		value["log_metadata"] !== true ||
		value["log_payload"] !== false ||
		value["max_attempts"] !== 1 ||
		!isNonnegativeFiniteNumber(value["request_timeout_ms"]) ||
		!Number.isInteger(value["request_timeout_ms"])
	) {
		throw new Error(`generation run operator status has invalid request provenance: ${body}`);
	}
	const requestFormat = value["request_format"];
	const responseDelivery = value["response_delivery"];
	const structuredOutput = value["structured_output"];
	if (requestFormat === undefined && responseDelivery === undefined && structuredOutput === undefined) {
		return {
			cache: "bypass",
			log_metadata: true,
			log_payload: false,
			max_attempts: 1,
			request_timeout_ms: value["request_timeout_ms"],
		};
	}
	if (
		(requestFormat !== "chat_completions" && requestFormat !== "responses") ||
		(responseDelivery !== "buffered" && responseDelivery !== "streaming") ||
		!isRecord(structuredOutput) ||
		!hasExactKeys(structuredOutput, ["format", "contract_name"]) ||
		(structuredOutput["format"] !== "openai_chat_json_schema" &&
			structuredOutput["format"] !== "openai_responses_json_schema") ||
		typeof structuredOutput["contract_name"] !== "string" ||
		structuredOutput["contract_name"].trim().length === 0
	) {
		throw new Error(`generation run operator status has invalid request provenance: ${body}`);
	}
	return {
		cache: "bypass",
		log_metadata: true,
		log_payload: false,
		max_attempts: 1,
		request_timeout_ms: value["request_timeout_ms"],
		request_format: requestFormat,
		response_delivery: responseDelivery,
		structured_output: {
			format: structuredOutput["format"],
			contract_name: structuredOutput["contract_name"],
		},
	};
}

export function parseRequestProvenance(value: unknown, body: string): WalkRequestProvenance {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, [
			"transport",
			"account_id",
			"gateway",
			"gateway_log_id",
			"requested_model",
			"correlation",
			"policy",
		]) ||
		value["transport"] !== "cloudflare_ai_gateway_rest" ||
		typeof value["account_id"] !== "string" ||
		value["account_id"].trim().length === 0 ||
		typeof value["requested_model"] !== "string" ||
		value["requested_model"].trim().length === 0
	) {
		throw new Error(`generation run operator status has invalid request provenance: ${body}`);
	}
	return {
		transport: "cloudflare_ai_gateway_rest",
		account_id: value["account_id"],
		gateway: parseGateway(value["gateway"], body),
		gateway_log_id: parseGatewayLogId(value["gateway_log_id"], body),
		requested_model: value["requested_model"],
		correlation: parseRequestCorrelation(value["correlation"], body),
		policy: parseRequestPolicy(value["policy"], body),
	};
}

export function parseModelUsageWithoutStep(
	value: unknown,
	body: string,
): WalkModelUsageFieldsWithoutStep {
	if (!isRecord(value)) {
		throw new Error(`generation run operator status has invalid model usage: ${body}`);
	}
	const keys = Object.keys(value).sort();
	const requiredKeys = ["execution", "external_billing", "model", "provider", "token_usage"];
	const allowedKeys = ["execution", "external_billing", "model", "provider", "request_provenance", "token_usage"];
	if (
		JSON.stringify(keys) !== JSON.stringify(requiredKeys) &&
		JSON.stringify(keys) !== JSON.stringify(allowedKeys)
	) {
		throw new Error(`generation run operator status has invalid model usage: ${body}`);
	}
	const provider = value["provider"];
	const model = value["model"];
	const execution = value["execution"];
	if (typeof provider !== "string" || provider.trim().length === 0 || typeof model !== "string" || model.trim().length === 0 || !isExecution(execution)) {
		throw new Error(`generation run operator status has invalid model usage: ${body}`);
	}
	return {
		provider,
		model,
		execution,
		token_usage: parseTokenUsage(value["token_usage"], body),
		external_billing: parseExternalBilling(value["external_billing"], body),
		...(value["request_provenance"] === undefined
			? {}
			: { request_provenance: parseRequestProvenance(value["request_provenance"], body) }),
	};
}

export function parseModelUsageFields<Step extends string>(
	value: unknown,
	body: string,
	isStep: (step: unknown) => step is Step,
): {
	production_step: Step;
	provider: string;
	model: string;
	execution: WalkExecution;
	token_usage: WalkTokenUsage;
	external_billing: WalkExternalBilling;
	request_provenance?: WalkRequestProvenance;
} {
	if (!isRecord(value)) {
		throw new Error(`generation run operator status has invalid model usage: ${body}`);
	}
	const productionStep = value["production_step"];
	if (!isStep(productionStep)) {
		throw new Error(`generation run operator status has invalid model usage: ${body}`);
	}
	const usageWithoutStep = { ...value };
	Reflect.deleteProperty(usageWithoutStep, "production_step");
	return { production_step: productionStep, ...parseModelUsageWithoutStep(usageWithoutStep, body) };
}
