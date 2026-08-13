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

export interface CloudflareAiGatewayContractIssue {
	readonly path: readonly (string | number)[];
	readonly code: string;
	readonly expected?: string;
	readonly received_type?: "array" | "boolean" | "null" | "number" | "object" | "string" | "undefined";
	readonly unexpected_keys?: readonly string[];
	readonly provider_code?: string;
	readonly provider_message?: string;
}

export interface CloudflareAiGatewayContractFailureDetails {
	readonly contract:
		| "cloudflare_ai_gateway_chat_completion_response"
		| "cloudflare_ai_gateway_http_error_response";
	readonly http_status?: number;
	readonly issues: readonly CloudflareAiGatewayContractIssue[];
}

interface CloudflareAiGatewayDeterministicErrorOptions extends ErrorOptions {
	readonly details?: CloudflareAiGatewayContractFailureDetails;
}

export class CloudflareAiGatewayDeterministicError extends Error {
	readonly code: CloudflareAiGatewayDeterministicErrorCode;
	readonly details: CloudflareAiGatewayContractFailureDetails | undefined;

	constructor(code: CloudflareAiGatewayDeterministicErrorCode, message: string, options?: CloudflareAiGatewayDeterministicErrorOptions) {
		super(message, options);
		this.name = "CloudflareAiGatewayDeterministicError";
		this.code = code;
		this.details = options?.details;
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
