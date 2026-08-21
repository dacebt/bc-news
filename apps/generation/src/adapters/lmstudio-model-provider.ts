import {
	PRODUCTION_STEP_OUTPUT_CONTRACTS,
	LmStudioDeterministicError,
	LmStudioRetryableError,
	createLmStudioModelProvider as createSharedLmStudioModelProvider,
	lmStudioSdkBaseUrl,
	type LmStudioInferenceConfig,
	type LmStudioReasoningEffort,
} from "@bc-news/model-adapters";

export { LmStudioDeterministicError, LmStudioRetryableError };
export const lmStudioNativeBaseUrl = lmStudioSdkBaseUrl;

export function createLmStudioModelProvider(input: {
	baseUrl: string;
	model: string;
	inference: LmStudioInferenceConfig;
	reasoningEffort: LmStudioReasoningEffort;
}) {
	return createSharedLmStudioModelProvider({
		baseUrl: input.baseUrl,
		requestedModel: input.model,
		inference: input.inference,
		reasoningEffort: input.reasoningEffort,
		structuredOutputContracts: PRODUCTION_STEP_OUTPUT_CONTRACTS,
	});
}
