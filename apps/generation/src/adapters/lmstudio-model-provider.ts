import {
	OpenAiCompatibleDeterministicError,
	OpenAiCompatibleRetryableError,
	LM_STUDIO_PRODUCTION_STEP_OUTPUT_CONTRACTS,
	createOpenAiCompatibleModelProvider,
	openAiCompatibleChatCompletionsUrl,
	type LmStudioReasoningEffort,
	type LmStudioSamplingConfig,
} from "@bc-news/model-adapters";

export {
	OpenAiCompatibleDeterministicError as LmStudioDeterministicError,
	OpenAiCompatibleRetryableError as LmStudioRetryableError,
};

export const lmStudioChatCompletionsUrl = openAiCompatibleChatCompletionsUrl;

export function createLmStudioModelProvider(input: {
	baseUrl: string;
	model: string;
	sampling: LmStudioSamplingConfig;
	reasoningEffort: LmStudioReasoningEffort;
}) {
	return createOpenAiCompatibleModelProvider({
		execution: "local_inference",
		baseUrl: input.baseUrl,
		requestedModel: input.model,
		sampling: input.sampling,
		reasoningEffort: input.reasoningEffort,
		structuredOutputContracts: LM_STUDIO_PRODUCTION_STEP_OUTPUT_CONTRACTS,
	});
}
