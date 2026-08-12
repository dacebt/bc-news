import { z } from "zod";
import {
	observedString,
	type ModelRuntimeEvidence,
	type ModelRuntimeIdentity,
	type ModelProviderPort,
} from "@bc-news/generation-core";
import {
	CloudflareAiGatewayModelSchema,
	type CloudflareAiGatewaySelection,
	type ModelTemperature,
} from "./config";
import {
	CloudflareAiGatewayDeterministicError,
	CloudflareAiGatewayRetryableError,
} from "./cloudflare-ai-gateway-errors";

export const CLOUDFLARE_AI_GATEWAY_REQUEST_TIMEOUT_MS = 600_000;

const NonBlankExactStringSchema = z.string().min(1).refine((value) => value.trim().length > 0);
const UsageSchema = z.strictObject({
	prompt_tokens: z.int().nonnegative(),
	completion_tokens: z.int().nonnegative(),
	total_tokens: z.int().nonnegative(),
	prompt_tokens_details: z.strictObject({
		cached_tokens: z.int().nonnegative().optional(),
		audio_tokens: z.int().nonnegative().optional(),
	}).optional(),
	completion_tokens_details: z.strictObject({
		reasoning_tokens: z.int().nonnegative().optional(),
		audio_tokens: z.int().nonnegative().optional(),
		accepted_prediction_tokens: z.int().nonnegative().optional(),
		rejected_prediction_tokens: z.int().nonnegative().optional(),
	}).optional(),
}).refine((usage) => usage.total_tokens === usage.prompt_tokens + usage.completion_tokens);

const CompletionSchema = z.strictObject({
	id: NonBlankExactStringSchema.optional(),
	object: z.literal("chat.completion").optional(),
	created: z.int().nonnegative().optional(),
	model: NonBlankExactStringSchema,
	choices: z.tuple([z.strictObject({
		index: z.int().nonnegative().optional(),
		message: z.strictObject({
			role: z.literal("assistant").optional(),
			content: NonBlankExactStringSchema,
			refusal: z.string().nullable().optional(),
			annotations: z.array(z.unknown()).optional(),
		}),
		finish_reason: z.string().nullable().optional(),
		logprobs: z.null().optional(),
	})]),
	usage: UsageSchema,
	service_tier: z.string().nullable().optional(),
	system_fingerprint: z.string().nullable().optional(),
	gatewayMetadata: z.strictObject({
		keySource: NonBlankExactStringSchema,
	}).optional(),
});

const unknownString = { state: "unknown" as const, reason: "not_reported" as const };
const unknownInteger = { state: "unknown" as const, reason: "not_reported" as const };
const unknownMeasurement = { state: "unknown" as const, reason: "not_reported" as const };
const providerControlledString = { state: "externally_controlled" as const, reason: "provider_controlled" as const };
const providerControlledInteger = { state: "externally_controlled" as const, reason: "provider_controlled" as const };
const providerControlledMeasurement = { state: "externally_controlled" as const, reason: "provider_controlled" as const };
const providerControlledBoolean = { state: "externally_controlled" as const, reason: "provider_controlled" as const };

function gatewayModelIdentity(requestedModel: string, responseModel?: string): ModelRuntimeIdentity {
	return {
		requested_identity: observedString(requestedModel),
		identifier: responseModel === undefined ? providerControlledString : observedString(responseModel),
		model_key: providerControlledString,
		path: providerControlledString,
		display_name: providerControlledString,
		format: providerControlledString,
		instance_reference: providerControlledString,
		size_bytes: providerControlledInteger,
		architecture: providerControlledString,
		parameter_count_description: providerControlledString,
		quantization_name: providerControlledString,
		quantization_bits: providerControlledMeasurement,
		vision_capable: providerControlledBoolean,
		trained_for_tool_use: providerControlledBoolean,
	};
}

function gatewayRuntimeEvidence(
	input: CloudflareAiGatewayProviderInput,
	completion: z.infer<typeof CompletionSchema>,
): ModelRuntimeEvidence {
	return {
		execution_context: {
			client_sdk_release: { state: "unknown", reason: "not_applicable" },
			provider_runtime_identity: observedString(completion.system_fingerprint),
			provider_runtime_version: providerControlledString,
			provider_runtime_build: providerControlledInteger,
			provider_service_tier: observedString(completion.service_tier),
			selected_model: gatewayModelIdentity(input.requestedModel),
			response_model: gatewayModelIdentity(input.requestedModel, completion.model),
			context_length: { state: "externally_controlled", reason: "provider_controlled" },
			requested_reasoning_posture: { state: "observed", value: "provider_default" },
			effective_reasoning_setting: providerControlledString,
			speculative_draft_model_identity: unknownString,
		},
		prediction_observation: {
			provider_response_id: observedString(completion.id),
			stop_reason: observedString(completion.choices[0].finish_reason),
			time_to_first_token_ms: unknownMeasurement,
			total_time_ms: unknownMeasurement,
			tokens_per_second: unknownMeasurement,
			speculative_total_tokens: unknownInteger,
			speculative_accepted_tokens: unknownInteger,
			speculative_rejected_tokens: unknownInteger,
			speculative_ignored_tokens: unknownInteger,
			reasoning_content_present: { state: "unknown", reason: "not_reported" },
		},
	};
}

export interface CloudflareAiGatewayProviderInput {
	readonly accountId: string;
	readonly apiToken: string;
	readonly gateway?: CloudflareAiGatewaySelection;
	readonly requestedModel: string;
	readonly temperature?: ModelTemperature;
}

export function cloudflareAiGatewayProviderForModel(model: string): string {
	const parsed = CloudflareAiGatewayModelSchema.safeParse(model);
	if (!parsed.success) {
		throw new CloudflareAiGatewayDeterministicError(
			"cloudflare_ai_gateway_invalid_config",
			"Cloudflare AI Gateway requested model must use author/model or @cf/author/model",
		);
	}
	if (parsed.data.startsWith("@cf/")) {
		return "workers_ai";
	}
	return parsed.data.split("/")[0]!;
}

export function cloudflareAiGatewayChatCompletionsUrl(accountId: string): URL {
	if (accountId.trim() !== accountId || accountId === "") {
		throw new CloudflareAiGatewayDeterministicError(
			"cloudflare_ai_gateway_invalid_config",
			"Cloudflare account id must be nonblank and contain no surrounding whitespace",
		);
	}
	return new URL(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/v1/chat/completions`);
}

function classifyTransportError(cause: unknown): Error {
	if (cause instanceof DOMException && (cause.name === "AbortError" || cause.name === "TimeoutError")) {
		return new CloudflareAiGatewayRetryableError(
			"cloudflare_ai_gateway_timeout",
			"Cloudflare AI Gateway completion timed out",
			{ cause },
		);
	}
	if (cause instanceof TypeError) {
		return new CloudflareAiGatewayRetryableError(
			"cloudflare_ai_gateway_network_failure",
			"Cloudflare AI Gateway completion failed at the network boundary",
			{ cause },
		);
	}
	return new CloudflareAiGatewayDeterministicError(
		"cloudflare_ai_gateway_unexpected_transport_failure",
		"Cloudflare AI Gateway completion failed with an unexpected transport error",
		{ cause },
	);
}

export function createCloudflareAiGatewayModelProvider(
	input: CloudflareAiGatewayProviderInput,
): ModelProviderPort {
	const endpoint = cloudflareAiGatewayChatCompletionsUrl(input.accountId);
	const provider = cloudflareAiGatewayProviderForModel(input.requestedModel);
	if (input.apiToken.trim() !== input.apiToken || input.apiToken === "") {
		throw new CloudflareAiGatewayDeterministicError(
			"cloudflare_ai_gateway_invalid_config",
			"Cloudflare API token must be nonblank and contain no surrounding whitespace",
		);
	}
	if (input.requestedModel.startsWith("@cf/") && input.gateway === undefined) {
		throw new CloudflareAiGatewayDeterministicError(
			"cloudflare_ai_gateway_invalid_config",
			"Cloudflare Workers AI models require a named AI Gateway",
		);
	}
	return {
		async complete(request) {
			if (request.correlation === undefined) {
				throw new CloudflareAiGatewayDeterministicError(
					"cloudflare_ai_gateway_missing_correlation",
					"Cloudflare AI Gateway completion requires run and invocation correlation",
				);
			}
			const headers: Record<string, string> = {
				Authorization: `Bearer ${input.apiToken}`,
				"Content-Type": "application/json",
				"cf-aig-skip-cache": "true",
				"cf-aig-collect-log": "true",
				"cf-aig-collect-log-payload": "false",
				"cf-aig-max-attempts": "1",
				"cf-aig-request-timeout": String(CLOUDFLARE_AI_GATEWAY_REQUEST_TIMEOUT_MS),
				"cf-aig-metadata": JSON.stringify({
					bc_news_run_id: request.correlation.run_id,
					bc_news_invocation_id: request.correlation.invocation_id,
					production_step: request.productionStep,
				}),
			};
			headers["cf-aig-gateway-id"] = input.gateway?.id ?? "default";
			let response: Response;
			try {
				response = await fetch(endpoint, {
					method: "POST",
					headers,
					body: JSON.stringify({
						model: input.requestedModel,
						...(input.temperature === undefined ? {} : { temperature: input.temperature }),
						messages: [
							{ role: "system", content: request.system },
							{ role: "user", content: request.user },
						],
					}),
					signal: AbortSignal.timeout(CLOUDFLARE_AI_GATEWAY_REQUEST_TIMEOUT_MS),
				});
			} catch (cause) {
				throw classifyTransportError(cause);
			}
			if ([408, 409, 425, 429].includes(response.status) || response.status >= 500) {
				throw new CloudflareAiGatewayRetryableError(
					"cloudflare_ai_gateway_retryable_http_status",
					`Cloudflare AI Gateway completion returned retryable HTTP status ${response.status}`,
				);
			}
			if (!response.ok) {
				throw new CloudflareAiGatewayDeterministicError(
					"cloudflare_ai_gateway_http_rejection",
					`Cloudflare AI Gateway completion rejected the request with HTTP status ${response.status}`,
				);
			}
			const gatewayLogId = response.headers.get("cf-aig-log-id");
			if (gatewayLogId === null || gatewayLogId.trim() === "") {
				throw new CloudflareAiGatewayDeterministicError(
					"cloudflare_ai_gateway_missing_log_id",
					"Cloudflare AI Gateway completion did not return cf-aig-log-id",
				);
			}
			let body: string;
			try {
				body = await response.text();
			} catch (cause) {
				throw new CloudflareAiGatewayRetryableError(
					"cloudflare_ai_gateway_network_failure",
					"Cloudflare AI Gateway completion failed while reading the response body",
					{ cause },
				);
			}
			let candidate: unknown;
			try {
				candidate = JSON.parse(body);
			} catch (cause) {
				throw new CloudflareAiGatewayDeterministicError(
					"cloudflare_ai_gateway_invalid_json",
					"Cloudflare AI Gateway completion response is not valid JSON",
					{ cause },
				);
			}
			const parsed = CompletionSchema.safeParse(candidate);
			if (!parsed.success) {
				throw new CloudflareAiGatewayDeterministicError(
					"cloudflare_ai_gateway_response_contract_rejected",
					"Cloudflare AI Gateway completion response rejected by the strict contract",
				);
			}
			const usage = parsed.data.usage;
			return {
				text: parsed.data.choices[0].message.content,
				provider,
				model: parsed.data.model,
				execution: "hosted_inference",
				token_usage: {
					measurement: "reported",
					input_tokens: usage.prompt_tokens,
					output_tokens: usage.completion_tokens,
					total_tokens: usage.total_tokens,
				},
				external_billing: {
					classification: "unavailable",
					reason: "provider_did_not_report_cost",
				},
				request_provenance: {
					transport: "cloudflare_ai_gateway_rest",
					account_id: input.accountId,
					gateway: input.gateway ?? { selection: "account_default" },
					gateway_log_id: gatewayLogId,
					requested_model: input.requestedModel,
					correlation: request.correlation,
					policy: {
						cache: "bypass",
						log_metadata: true,
						log_payload: false,
						max_attempts: 1,
						request_timeout_ms: CLOUDFLARE_AI_GATEWAY_REQUEST_TIMEOUT_MS,
					},
				},
				runtime_evidence: gatewayRuntimeEvidence(input, parsed.data),
			};
		},
	};
}
