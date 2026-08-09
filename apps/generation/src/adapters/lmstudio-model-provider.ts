import {
	LM_STUDIO_PRODUCTION_STEP_OUTPUT_CONTRACTS,
	LmStudioDeterministicError,
	LmStudioRetryableError,
	createLmStudioModelProvider as createSharedLmStudioModelProvider,
	lmStudioSdkBaseUrl,
	type LmStudioReasoningEffort,
	type ModelTemperature,
} from "@bc-news/model-adapters";

export { LmStudioDeterministicError, LmStudioRetryableError };
export const lmStudioNativeBaseUrl = lmStudioSdkBaseUrl;

export function createLmStudioModelProvider(input: {
	baseUrl: string;
	model: string;
	temperature?: ModelTemperature;
	reasoningEffort: LmStudioReasoningEffort;
}) {
	return createSharedLmStudioModelProvider({
		baseUrl: input.baseUrl,
		requestedModel: input.model,
		...(input.temperature === undefined ? {} : { temperature: input.temperature }),
		reasoningEffort: input.reasoningEffort,
		structuredOutputContracts: LM_STUDIO_PRODUCTION_STEP_OUTPUT_CONTRACTS,
	});
}
