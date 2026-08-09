import {
	LM_STUDIO_PRODUCTION_STEP_OUTPUT_CONTRACTS,
	LmStudioDeterministicError,
	LmStudioRetryableError,
	createLmStudioModelProvider as createSharedLmStudioModelProvider,
	lmStudioSdkBaseUrl,
	type LmStudioReasoningEffort,
	type LmStudioSamplingConfig,
} from "@bc-news/model-adapters";

export { LmStudioDeterministicError, LmStudioRetryableError };
export const lmStudioNativeBaseUrl = lmStudioSdkBaseUrl;

export function createLmStudioModelProvider(input: {
	baseUrl: string;
	model: string;
	sampling?: LmStudioSamplingConfig;
	reasoningEffort: LmStudioReasoningEffort;
}) {
	return createSharedLmStudioModelProvider({
		baseUrl: input.baseUrl,
		requestedModel: input.model,
		...(input.sampling === undefined ? {} : { sampling: input.sampling }),
		reasoningEffort: input.reasoningEffort,
		structuredOutputContracts: LM_STUDIO_PRODUCTION_STEP_OUTPUT_CONTRACTS,
	});
}
