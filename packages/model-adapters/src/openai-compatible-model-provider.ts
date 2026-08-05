import { z } from "zod";
import type { ExternalBilling, ModelProviderPort } from "@bc-news/generation-core";
import type { CalculatedBillingConfig } from "./config";
import {
	OpenAiCompatibleDeterministicError,
	OpenAiCompatibleRetryableError,
} from "./errors";

const PromptTokenDetailsSchema = z.strictObject({
	cached_tokens: z.int().nonnegative().optional(),
	audio_tokens: z.int().nonnegative().optional(),
});

const CompletionTokenDetailsSchema = z.strictObject({
	reasoning_tokens: z.int().nonnegative().optional(),
	audio_tokens: z.int().nonnegative().optional(),
	accepted_prediction_tokens: z.int().nonnegative().optional(),
	rejected_prediction_tokens: z.int().nonnegative().optional(),
});

const UsageSchema = z
	.strictObject({
		prompt_tokens: z.int().nonnegative(),
		completion_tokens: z.int().nonnegative(),
		total_tokens: z.int().nonnegative(),
		prompt_tokens_details: PromptTokenDetailsSchema.optional(),
		completion_tokens_details: CompletionTokenDetailsSchema.optional(),
	})
	.refine((usage) => usage.total_tokens === usage.prompt_tokens + usage.completion_tokens);

const CompletionSchema = z.strictObject({
	id: z.string().trim().min(1).optional(),
	object: z.literal("chat.completion").optional(),
	created: z.int().nonnegative().optional(),
	model: z.string().trim().min(1),
	choices: z.tuple([
		z.strictObject({
			index: z.int().nonnegative().optional(),
			message: z.strictObject({
				role: z.literal("assistant").optional(),
				content: z.string().trim().min(1),
				refusal: z.string().nullable().optional(),
			}),
			finish_reason: z.string().nullable().optional(),
			logprobs: z.null().optional(),
		}),
	]),
	usage: UsageSchema.optional(),
	service_tier: z.string().nullable().optional(),
	system_fingerprint: z.string().nullable().optional(),
});

const LmStudioCompletionSchema = z.strictObject({
	id: z.string().trim().min(1).optional(),
	object: z.literal("chat.completion").optional(),
	created: z.int().nonnegative().optional(),
	model: z.string().trim().min(1),
	choices: z.tuple([
		z.strictObject({
			index: z.int().nonnegative().optional(),
			message: z
				.strictObject({
					role: z.literal("assistant").optional(),
					content: z.string().trim().min(1),
					refusal: z.string().nullable().optional(),
					reasoning: z.string().optional(),
					reasoning_content: z.string().optional(),
					tool_calls: z.tuple([]).optional(),
				})
				.refine(
					(message) => message.reasoning === undefined || message.reasoning_content === undefined,
				),
			finish_reason: z.string().nullable().optional(),
			logprobs: z.null().optional(),
		}),
	]),
	usage: UsageSchema.optional(),
	service_tier: z.string().nullable().optional(),
	system_fingerprint: z.string().nullable().optional(),
	stats: z.strictObject({}).optional(),
});

interface LocalProviderInput {
	readonly execution: "local_inference";
	readonly baseUrl: string;
	readonly requestedModel: string;
}

interface HostedProviderInput {
	readonly execution: "hosted_inference";
	readonly baseUrl: string;
	readonly apiKey: string;
	readonly provider: string;
	readonly requestedModel: string;
	readonly billing: CalculatedBillingConfig;
}

export type OpenAiCompatibleProviderInput = LocalProviderInput | HostedProviderInput;

export function openAiCompatibleChatCompletionsUrl(rawBaseUrl: string): URL {
	if (rawBaseUrl.trim() !== rawBaseUrl) {
		throw new OpenAiCompatibleDeterministicError(
			"openai_compatible_invalid_config",
			"OpenAI-compatible base URL must not contain surrounding whitespace",
		);
	}
	let baseUrl: URL;
	try {
		baseUrl = new URL(rawBaseUrl);
	} catch {
		throw new OpenAiCompatibleDeterministicError(
			"openai_compatible_invalid_config",
			"OpenAI-compatible base URL is not a valid URL",
		);
	}
	if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
		throw new OpenAiCompatibleDeterministicError(
			"openai_compatible_invalid_config",
			"OpenAI-compatible base URL must use HTTP or HTTPS",
		);
	}
	if (baseUrl.username !== "" || baseUrl.password !== "") {
		throw new OpenAiCompatibleDeterministicError(
			"openai_compatible_invalid_config",
			"OpenAI-compatible base URL must not include credentials",
		);
	}
	if (baseUrl.search !== "" || baseUrl.hash !== "") {
		throw new OpenAiCompatibleDeterministicError(
			"openai_compatible_invalid_config",
			"OpenAI-compatible base URL must not include a query or fragment",
		);
	}
	baseUrl.pathname = `${baseUrl.pathname.replace(/\/+$/, "")}/chat/completions`;
	return baseUrl;
}

function classifyTransportError(cause: unknown): Error {
	if (cause instanceof DOMException && (cause.name === "AbortError" || cause.name === "TimeoutError")) {
		return new OpenAiCompatibleRetryableError(
			"openai_compatible_timeout",
			"OpenAI-compatible completion timed out",
			{ cause },
		);
	}
	if (cause instanceof TypeError) {
		return new OpenAiCompatibleRetryableError(
			"openai_compatible_network_failure",
			"OpenAI-compatible completion failed at the network boundary",
			{ cause },
		);
	}
	return new OpenAiCompatibleDeterministicError(
		"openai_compatible_unexpected_transport_failure",
		"OpenAI-compatible completion failed with an unexpected transport error",
		{ cause },
	);
}

function calculatedBilling(
	usage: z.infer<typeof UsageSchema>,
	config: CalculatedBillingConfig,
): ExternalBilling {
	const amount =
		(usage.prompt_tokens * config.input_usd_per_million_tokens +
			usage.completion_tokens * config.output_usd_per_million_tokens) /
		1_000_000;
	if (!Number.isFinite(amount) || amount < 0) {
		throw new OpenAiCompatibleDeterministicError(
			"openai_compatible_impossible_cost",
			"OpenAI-compatible completion cost cannot be represented",
		);
	}
	return {
		classification: "calculated",
		amount_usd: amount,
		pricing_reference: config.pricing_reference,
	};
}

export function createOpenAiCompatibleModelProvider(
	input: OpenAiCompatibleProviderInput,
): ModelProviderPort {
	const endpoint = openAiCompatibleChatCompletionsUrl(input.baseUrl);
	if (input.requestedModel.trim() === "") {
		throw new OpenAiCompatibleDeterministicError(
			"openai_compatible_invalid_config",
			"OpenAI-compatible requested model must be nonblank",
		);
	}
	if (input.execution === "hosted_inference" && input.apiKey.trim() === "") {
		throw new OpenAiCompatibleDeterministicError(
			"openai_compatible_invalid_config",
			"Hosted OpenAI-compatible API key must be nonblank",
		);
	}
	return {
		async complete(request) {
			let response: Response;
			try {
				response = await fetch(endpoint, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${input.execution === "hosted_inference" ? input.apiKey : "lmstudio"}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						model: input.requestedModel,
						messages: [
							{ role: "system", content: request.system },
							{ role: "user", content: request.user },
						],
					}),
					signal: AbortSignal.timeout(600_000),
				});
			} catch (cause) {
				throw classifyTransportError(cause);
			}
			if ([408, 409, 425, 429].includes(response.status) || response.status >= 500) {
				throw new OpenAiCompatibleRetryableError(
					"openai_compatible_retryable_http_status",
					`OpenAI-compatible completion returned retryable HTTP status ${response.status}`,
				);
			}
			if (!response.ok) {
				throw new OpenAiCompatibleDeterministicError(
					"openai_compatible_http_rejection",
					`OpenAI-compatible completion rejected the request with HTTP status ${response.status}`,
				);
			}
			let body: string;
			try {
				body = await response.text();
			} catch (cause) {
				throw new OpenAiCompatibleRetryableError(
					"openai_compatible_network_failure",
					"OpenAI-compatible completion failed while reading the response body",
					{ cause },
				);
			}
			let candidate: unknown;
			try {
				candidate = JSON.parse(body);
			} catch (cause) {
				throw new OpenAiCompatibleDeterministicError(
					"openai_compatible_invalid_json",
					"OpenAI-compatible completion response is not valid JSON",
					{ cause },
				);
			}
			const parsed = input.execution === "local_inference"
				? LmStudioCompletionSchema.safeParse(candidate)
				: CompletionSchema.safeParse(candidate);
			if (!parsed.success || (input.execution === "hosted_inference" && parsed.data.usage === undefined)) {
				throw new OpenAiCompatibleDeterministicError(
					"openai_compatible_response_contract_rejected",
					"OpenAI-compatible completion response rejected by the strict contract",
				);
			}
			const usage = parsed.data.usage;
			return {
				text: parsed.data.choices[0].message.content,
				provider: input.execution === "hosted_inference" ? input.provider : "lmstudio",
				model: parsed.data.model,
				execution: input.execution,
				token_usage:
					usage === undefined
						? { measurement: "unavailable" }
						: {
								measurement: "reported",
								input_tokens: usage.prompt_tokens,
								output_tokens: usage.completion_tokens,
								total_tokens: usage.total_tokens,
							},
				external_billing:
					input.execution === "hosted_inference"
						? calculatedBilling(usage!, input.billing)
						: { classification: "none", amount_usd: 0, reason: "local_inference" },
			};
		},
	};
}
