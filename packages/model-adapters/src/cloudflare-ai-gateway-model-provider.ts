import { type ModelProviderPort } from "@bc-news/generation-core";
import { type CloudflareAiGatewaySelection, type ModelTemperature } from "./config";
import {
	cloudflareAiGatewayContractFailureDetails,
	cloudflareAiGatewayHttpRejectionDetails,
} from "./cloudflare-ai-gateway-contract-details";
import { assembleCloudflareChatCompletionStream } from "./cloudflare-chat-completion-stream";
import {
	CloudflareChatCompletionSchema,
	cloudflareChatCompletionsRuntimeEvidence,
} from "./cloudflare-chat-completions-codec";
import {
	CloudflareResponsesSchema,
	cloudflareHostedResponsesRequestBody,
	cloudflareHostedResponsesText,
	cloudflareResponsesRuntimeEvidence,
} from "./cloudflare-responses-codec";
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
} from "./cloudflare-ai-gateway-errors";
import type { ProductionStepOutputContracts } from "./production-step-output-contracts";

export const CLOUDFLARE_AI_GATEWAY_REQUEST_TIMEOUT_MS = 600_000;

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
	return cloudflareAiGatewayUrl(accountId, "chat_completions");
}

function cloudflareAiGatewayResponsesUrl(accountId: string): URL {
	return cloudflareAiGatewayUrl(accountId, "responses");
}

function cloudflareAiGatewayUrl(
	accountId: string,
	requestFormat: "chat_completions" | "responses",
): URL {
	if (accountId.trim() !== accountId || accountId === "") {
		throw new CloudflareAiGatewayDeterministicError(
			"cloudflare_ai_gateway_invalid_config",
			"Cloudflare account id must be nonblank and contain no surrounding whitespace",
		);
	}
	const path = requestFormat === "responses" ? "responses" : "chat/completions";
	return new URL(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/v1/${path}`);
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
	const requestedModel = requireCloudflareHostedModel(input.requestedModel);
	const requestProfile = CLOUDFLARE_HOSTED_MODEL_REQUEST_PROFILES[requestedModel];
	const endpoint = requestProfile.requestFormat === "responses"
		? cloudflareAiGatewayResponsesUrl(input.accountId)
		: cloudflareAiGatewayChatCompletionsUrl(input.accountId);
	const provider = requestProfile.provider;
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
					body: JSON.stringify(requestProfile.requestFormat === "responses"
						? cloudflareHostedResponsesRequestBody({
							model: requestedModel,
							system: request.system,
							user: request.user,
							...(input.temperature === undefined ? {} : { temperature: input.temperature }),
							outputContract,
						})
						: cloudflareHostedModelRequestBody({
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
					{ details: await cloudflareAiGatewayHttpRejectionDetails(response) },
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
			if (requestProfile.responseDelivery === "streaming") {
				candidate = assembleCloudflareChatCompletionStream(body);
			} else {
				try {
					candidate = JSON.parse(body);
				} catch (cause) {
					throw new CloudflareAiGatewayDeterministicError(
						"cloudflare_ai_gateway_invalid_json",
						"Cloudflare AI Gateway completion response is not valid JSON",
						{ cause },
					);
				}
			}
			if (requestProfile.requestFormat === "responses") {
				const parsed = CloudflareResponsesSchema.safeParse(candidate);
				if (!parsed.success) {
					throw new CloudflareAiGatewayDeterministicError(
						"cloudflare_ai_gateway_response_contract_rejected",
						"Cloudflare AI Gateway completion response rejected by the strict contract",
						{
							details: cloudflareAiGatewayContractFailureDetails(
								"cloudflare_ai_gateway_responses_response",
								candidate,
								parsed.error,
							),
						},
					);
				}
				const usage = parsed.data.usage;
				return {
					text: cloudflareHostedResponsesText({
						model: requestedModel,
						response: parsed.data,
						outputContract,
					}),
					provider,
					model: parsed.data.model,
					execution: "hosted_inference",
					token_usage: {
						measurement: "reported",
						input_tokens: usage.input_tokens,
						output_tokens: usage.output_tokens,
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
							response_delivery: requestProfile.responseDelivery,
							structured_output: {
								format: requestProfile.structuredOutputFormat,
								contract_name: outputContract.name,
							},
						},
					},
					runtime_evidence: cloudflareResponsesRuntimeEvidence(requestedModel, parsed.data),
				};
			}
			const parsed = CloudflareChatCompletionSchema.safeParse(candidate);
			if (!parsed.success) {
				throw new CloudflareAiGatewayDeterministicError(
					"cloudflare_ai_gateway_response_contract_rejected",
					"Cloudflare AI Gateway completion response rejected by the strict contract",
					{
						details: cloudflareAiGatewayContractFailureDetails(
							"cloudflare_ai_gateway_chat_completion_response",
							candidate,
							parsed.error,
						),
					},
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
					output_tokens: usage.total_tokens - usage.prompt_tokens,
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
						response_delivery: requestProfile.responseDelivery,
						structured_output: {
							format: requestProfile.structuredOutputFormat,
							contract_name: outputContract.name,
						},
					},
				},
				runtime_evidence: cloudflareChatCompletionsRuntimeEvidence(requestedModel, parsed.data),
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
