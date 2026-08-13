import { z } from "zod";
import {
	observedString,
	type ModelRuntimeEvidence,
	type ModelRuntimeIdentity,
	type ModelProviderPort,
} from "@bc-news/generation-core";
import {
	type CloudflareAiGatewaySelection,
	type ModelTemperature,
} from "./config";
import {
	CLOUDFLARE_HOSTED_MODEL_REQUEST_PROFILES,
	CloudflareHostedModelIdSchema,
	cloudflareHostedModelRequestBody,
	cloudflareHostedModelResponseText,
	type CloudflareHostedModelId,
} from "./cloudflare-hosted-model-profiles";
import {
	CloudflareAiGatewayDeterministicError,
	CloudflareAiGatewayRetryableError,
	type CloudflareAiGatewayContractIssue,
	type CloudflareAiGatewayContractFailureDetails,
} from "./cloudflare-ai-gateway-errors";
import type { ProductionStepOutputContracts } from "./production-step-output-contracts";

export const CLOUDFLARE_AI_GATEWAY_REQUEST_TIMEOUT_MS = 600_000;

const NonBlankExactStringSchema = z.string().min(1).refine((value) => value.trim().length > 0);
const UsageSchema = z.looseObject({
	prompt_tokens: z.int().nonnegative(),
	completion_tokens: z.int().nonnegative(),
	total_tokens: z.int().nonnegative(),
}).refine((usage) => usage.total_tokens === usage.prompt_tokens + usage.completion_tokens);

const ChoiceSchema = z.looseObject({
	message: z.looseObject({
		content: NonBlankExactStringSchema.nullable(),
	}),
	finish_reason: z.string().nullable().optional(),
});

const CompletionSchema = z.looseObject({
	id: NonBlankExactStringSchema.optional(),
	model: NonBlankExactStringSchema,
	choices: z.tuple([ChoiceSchema]).rest(z.unknown()),
	usage: UsageSchema,
	service_tier: z.string().nullable().optional(),
	system_fingerprint: z.string().nullable().optional(),
});

const ProviderHttpErrorSchema = z.looseObject({
	message: z.string().min(1),
	type: z.string().min(1).optional(),
	param: z.string().min(1).nullable().optional(),
	code: z.union([z.string().min(1), z.number()]).nullable().optional(),
});

const ProviderHttpSingleErrorEnvelopeSchema = z.looseObject({ error: ProviderHttpErrorSchema });
const ProviderHttpErrorArrayEnvelopeSchema = z.looseObject({
	errors: z.array(ProviderHttpErrorSchema).min(1),
});

function receivedType(value: unknown): NonNullable<CloudflareAiGatewayContractIssue["received_type"]> {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	const type = typeof value;
	return type === "boolean" || type === "number" || type === "object" || type === "string" ? type : "undefined";
}

function valueAtPath(candidate: unknown, path: readonly PropertyKey[]): unknown {
	let value = candidate;
	for (const segment of path) {
		if (typeof segment === "symbol" || value === null || typeof value !== "object") return undefined;
		value = (value as Record<PropertyKey, unknown>)[segment];
	}
	return value;
}

function completionContractFailureDetails(candidate: unknown, error: z.ZodError): CloudflareAiGatewayContractFailureDetails {
	return {
		contract: "cloudflare_ai_gateway_chat_completion_response",
		issues: error.issues.map((issue) => ({
			path: issue.path.map((segment) => typeof segment === "symbol" ? segment.toString() : segment),
			code: issue.code,
			...("expected" in issue && typeof issue.expected === "string" ? { expected: issue.expected } : {}),
			received_type: receivedType(valueAtPath(candidate, issue.path)),
			...("keys" in issue && Array.isArray(issue.keys) ? { unexpected_keys: issue.keys.filter((key): key is string => typeof key === "string") } : {}),
		})),
	};
}

function boundedProviderMessage(value: string): string {
	return value.length <= 4_000 ? value : `${value.slice(0, 4_000)} [truncated]`;
}

async function httpRejectionDetails(response: Response): Promise<CloudflareAiGatewayContractFailureDetails> {
	let body: string;
	try {
		body = await response.text();
	} catch {
		return {
			contract: "cloudflare_ai_gateway_http_error_response",
			http_status: response.status,
			issues: [{ path: [], code: "error_body_read_failed" }],
		};
	}
	if (body === "") {
		return {
			contract: "cloudflare_ai_gateway_http_error_response",
			http_status: response.status,
			issues: [{ path: [], code: "empty_error_body" }],
		};
	}
	let candidate: unknown;
	try {
		candidate = JSON.parse(body);
	} catch {
		return {
			contract: "cloudflare_ai_gateway_http_error_response",
			http_status: response.status,
			issues: [{
				path: [],
				code: "unstructured_error_body",
				provider_message: boundedProviderMessage(body),
			}],
		};
	}
	const singleError = ProviderHttpSingleErrorEnvelopeSchema.safeParse(candidate);
	const errorArray = ProviderHttpErrorArrayEnvelopeSchema.safeParse(candidate);
	let errors: Array<z.infer<typeof ProviderHttpErrorSchema>>;
	if (singleError.success) {
		errors = [singleError.data.error];
	} else if (errorArray.success) {
		errors = errorArray.data.errors;
	} else {
		return {
			contract: "cloudflare_ai_gateway_http_error_response",
			http_status: response.status,
			issues: [{ path: [], code: "unrecognized_error_contract", received_type: receivedType(candidate) }],
		};
	}
	return {
		contract: "cloudflare_ai_gateway_http_error_response",
		http_status: response.status,
		issues: errors.map((error, index) => ({
			path: error.param === undefined || error.param === null
				? ["errors", index]
				: [error.param],
			code: "provider_rejection",
			...((error.code ?? error.type) === undefined
				? {}
				: { provider_code: String(error.code ?? error.type) }),
			provider_message: boundedProviderMessage(error.message),
		})),
	};
}

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
	requestedModel: string,
	completion: z.infer<typeof CompletionSchema>,
): ModelRuntimeEvidence {
	return {
		execution_context: {
			client_sdk_release: { state: "unknown", reason: "not_applicable" },
			provider_runtime_identity: observedString(completion.system_fingerprint),
			provider_runtime_version: providerControlledString,
			provider_runtime_build: providerControlledInteger,
			provider_service_tier: observedString(completion.service_tier),
			selected_model: gatewayModelIdentity(requestedModel),
			response_model: gatewayModelIdentity(requestedModel, completion.model),
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
	readonly structuredOutputContracts: ProductionStepOutputContracts;
}

export function cloudflareAiGatewayProviderForModel(model: string): string {
	return CLOUDFLARE_HOSTED_MODEL_REQUEST_PROFILES[requireCloudflareHostedModel(model)].provider;
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
	const requestedModel = requireCloudflareHostedModel(input.requestedModel);
	const provider = CLOUDFLARE_HOSTED_MODEL_REQUEST_PROFILES[requestedModel].provider;
	if (input.apiToken.trim() !== input.apiToken || input.apiToken === "") {
		throw new CloudflareAiGatewayDeterministicError(
			"cloudflare_ai_gateway_invalid_config",
			"Cloudflare API token must be nonblank and contain no surrounding whitespace",
		);
	}
	if (requestedModel.startsWith("@cf/") && input.gateway === undefined) {
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
			const outputContract = input.structuredOutputContracts[request.productionStep];
			const requestProfile = CLOUDFLARE_HOSTED_MODEL_REQUEST_PROFILES[requestedModel];
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
					body: JSON.stringify(cloudflareHostedModelRequestBody({
						model: requestedModel,
						system: request.system,
						user: request.user,
						...(input.temperature === undefined ? {} : { temperature: input.temperature }),
						outputContract,
					})),
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
					{ details: await httpRejectionDetails(response) },
				);
			}
			const reportedGatewayLogId = response.headers.get("cf-aig-log-id");
			const gatewayLogId = reportedGatewayLogId === null || reportedGatewayLogId.trim() === ""
				? { state: "unavailable" as const, reason: "provider_did_not_report" as const }
				: reportedGatewayLogId;
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
					{ details: completionContractFailureDetails(candidate, parsed.error) },
				);
			}
			const usage = parsed.data.usage;
			return {
				text: cloudflareHostedModelResponseText({
					model: requestedModel,
					text: parsed.data.choices[0].message.content,
					outputContract,
				}),
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
					requested_model: requestedModel,
					correlation: request.correlation,
					policy: {
						cache: "bypass",
						log_metadata: true,
						log_payload: false,
						max_attempts: 1,
						request_timeout_ms: CLOUDFLARE_AI_GATEWAY_REQUEST_TIMEOUT_MS,
						request_format: requestProfile.requestFormat,
						structured_output: {
							format: requestProfile.structuredOutputFormat,
							contract_name: outputContract.name,
						},
					},
				},
				runtime_evidence: gatewayRuntimeEvidence(requestedModel, parsed.data),
			};
		},
	};
}

function requireCloudflareHostedModel(model: string): CloudflareHostedModelId {
	const parsed = CloudflareHostedModelIdSchema.safeParse(model);
	if (!parsed.success) {
		throw new CloudflareAiGatewayDeterministicError(
			"cloudflare_ai_gateway_invalid_config",
			"Cloudflare AI Gateway requested model must have a researched request profile",
		);
	}
	return parsed.data;
}
