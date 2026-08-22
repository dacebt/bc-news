export type LmStudioDeterministicErrorCode =
	| "lmstudio_invalid_config"
	| "lmstudio_loaded_model_not_found"
	| "lmstudio_loaded_model_ambiguous"
	| "lmstudio_completion_incomplete"
	| "lmstudio_response_contract_rejected"
	| "lmstudio_prediction_config_mismatch"
	| "lmstudio_usage_contract_rejected";

export type LmStudioRetryableErrorCode =
	| "lmstudio_timeout"
	| "lmstudio_sdk_failure";

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
