export type CloudflareAiGatewayDeterministicErrorCode =
	| "cloudflare_ai_gateway_invalid_config"
	| "cloudflare_ai_gateway_missing_correlation"
	| "cloudflare_ai_gateway_http_rejection"
	| "cloudflare_ai_gateway_invalid_json"
	| "cloudflare_ai_gateway_response_contract_rejected"
	| "cloudflare_ai_gateway_unexpected_transport_failure";

export type CloudflareAiGatewayRetryableErrorCode =
	| "cloudflare_ai_gateway_network_failure"
	| "cloudflare_ai_gateway_timeout"
	| "cloudflare_ai_gateway_retryable_http_status";

export class CloudflareAiGatewayDeterministicError extends Error {
	readonly code: CloudflareAiGatewayDeterministicErrorCode;

	constructor(code: CloudflareAiGatewayDeterministicErrorCode, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "CloudflareAiGatewayDeterministicError";
		this.code = code;
	}
}

export class CloudflareAiGatewayRetryableError extends Error {
	readonly code: CloudflareAiGatewayRetryableErrorCode;

	constructor(code: CloudflareAiGatewayRetryableErrorCode, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "CloudflareAiGatewayRetryableError";
		this.code = code;
	}
}
