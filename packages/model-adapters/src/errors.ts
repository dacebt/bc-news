export type OpenAiCompatibleDeterministicErrorCode =
	| "openai_compatible_invalid_config"
	| "openai_compatible_http_rejection"
	| "openai_compatible_invalid_json"
	| "openai_compatible_response_contract_rejected"
	| "openai_compatible_impossible_cost"
	| "openai_compatible_unexpected_transport_failure";

export type OpenAiCompatibleRetryableErrorCode =
	| "openai_compatible_network_failure"
	| "openai_compatible_timeout"
	| "openai_compatible_retryable_http_status";

export class OpenAiCompatibleDeterministicError extends Error {
	readonly code: OpenAiCompatibleDeterministicErrorCode;

	constructor(code: OpenAiCompatibleDeterministicErrorCode, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "OpenAiCompatibleDeterministicError";
		this.code = code;
	}
}

export class OpenAiCompatibleRetryableError extends Error {
	readonly code: OpenAiCompatibleRetryableErrorCode;

	constructor(code: OpenAiCompatibleRetryableErrorCode, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "OpenAiCompatibleRetryableError";
		this.code = code;
	}
}
