import { z } from "zod";
import type { ModelProviderPort } from "@bc-news/generation-core";
import { GenerationConfigError } from "../config-error";

const OpenAiCompletionSchema = z.object({
	choices: z
		.array(
			z.object({
				message: z.object({ content: z.string().min(1) }),
			}),
		)
		.min(1),
});

type LmStudioDeterministicErrorCode =
	| "lmstudio_http_rejection"
	| "lmstudio_invalid_json"
	| "lmstudio_response_contract_rejected"
	| "lmstudio_unexpected_transport_failure";

type LmStudioRetryableErrorCode =
	| "lmstudio_network_failure"
	| "lmstudio_timeout"
	| "lmstudio_retryable_http_status";

export class LmStudioDeterministicError extends Error {
	readonly code: LmStudioDeterministicErrorCode;

	constructor(code: LmStudioDeterministicErrorCode, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "LmStudioDeterministicError";
		this.code = code;
	}
}

export class LmStudioRetryableError extends Error {
	readonly code: LmStudioRetryableErrorCode;

	constructor(code: LmStudioRetryableErrorCode, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "LmStudioRetryableError";
		this.code = code;
	}
}

export function lmStudioChatCompletionsUrl(rawBaseUrl: string): URL {
	if (rawBaseUrl.trim() !== rawBaseUrl) {
		throw new GenerationConfigError("LMSTUDIO_BASE_URL must not contain surrounding whitespace");
	}
	let baseUrl: URL;
	try {
		baseUrl = new URL(rawBaseUrl);
	} catch (cause) {
		throw new GenerationConfigError("LMSTUDIO_BASE_URL is not a valid URL", { cause });
	}
	if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
		throw new GenerationConfigError("LMSTUDIO_BASE_URL must use HTTP or HTTPS");
	}
	if (baseUrl.username !== "" || baseUrl.password !== "") {
		throw new GenerationConfigError("LMSTUDIO_BASE_URL must not include credentials");
	}
	if (baseUrl.search !== "" || baseUrl.hash !== "") {
		throw new GenerationConfigError("LMSTUDIO_BASE_URL must not include a query or fragment");
	}
	baseUrl.pathname = `${baseUrl.pathname.replace(/\/+$/, "")}/chat/completions`;
	return baseUrl;
}

function transportError(cause: unknown): LmStudioRetryableError | LmStudioDeterministicError {
	if (
		cause instanceof DOMException &&
		(cause.name === "AbortError" || cause.name === "TimeoutError")
	) {
		return new LmStudioRetryableError(
			"lmstudio_timeout",
			"LM Studio completion timed out after 600 seconds",
			{ cause },
		);
	}
	if (cause instanceof TypeError) {
		return new LmStudioRetryableError(
			"lmstudio_network_failure",
			"LM Studio completion failed at the network boundary",
			{ cause },
		);
	}
	return new LmStudioDeterministicError(
		"lmstudio_unexpected_transport_failure",
		"LM Studio completion failed with an unexpected transport error",
		{ cause },
	);
}

function responseBodyTransportError(cause: unknown): LmStudioRetryableError {
	const classified = transportError(cause);
	if (classified instanceof LmStudioRetryableError) return classified;
	return new LmStudioRetryableError(
		"lmstudio_network_failure",
		"LM Studio completion failed while reading the response body",
		{ cause },
	);
}

export function createLmStudioModelProvider(input: {
	baseUrl: string;
	model: string;
}): ModelProviderPort {
	const endpoint = lmStudioChatCompletionsUrl(input.baseUrl);
	return {
		async complete(request) {
			let response: Response;
			try {
				response = await fetch(endpoint, {
					method: "POST",
					headers: {
						Authorization: "Bearer lmstudio",
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						model: input.model,
						messages: [
							{ role: "system", content: request.system },
							{ role: "user", content: request.user },
						],
					}),
					signal: AbortSignal.timeout(600_000),
				});
			} catch (cause) {
				throw transportError(cause);
			}

			if (response.status === 429 || response.status >= 500) {
				throw new LmStudioRetryableError(
					"lmstudio_retryable_http_status",
					`LM Studio completion returned retryable HTTP status ${response.status}`,
				);
			}
			if (!response.ok) {
				throw new LmStudioDeterministicError(
					"lmstudio_http_rejection",
					`LM Studio completion rejected the request with HTTP status ${response.status}`,
				);
			}

			let responseBody: string;
			try {
				responseBody = await response.text();
			} catch (cause) {
				throw responseBodyTransportError(cause);
			}

			let candidate: unknown;
			try {
				candidate = JSON.parse(responseBody);
			} catch (cause) {
				throw new LmStudioDeterministicError(
					"lmstudio_invalid_json",
					"LM Studio completion response is not valid JSON",
					{ cause },
				);
			}
			const parsed = OpenAiCompletionSchema.safeParse(candidate);
			if (!parsed.success) {
				throw new LmStudioDeterministicError(
					"lmstudio_response_contract_rejected",
					`LM Studio completion response rejected: ${parsed.error.message}`,
				);
			}
			const choice = parsed.data.choices[0];
			if (choice === undefined) {
				throw new LmStudioDeterministicError(
					"lmstudio_response_contract_rejected",
					"LM Studio completion response contains no choices",
				);
			}
			return { text: choice.message.content, provider: "lmstudio", model: input.model };
		},
	};
}
