import {
	OpenAiCompatibleDeterministicError,
	OpenAiCompatibleRetryableError,
	createOpenAiCompatibleModelProvider,
	openAiCompatibleChatCompletionsUrl,
} from "@bc-news/model-adapters";

export {
	OpenAiCompatibleDeterministicError as LmStudioDeterministicError,
	OpenAiCompatibleRetryableError as LmStudioRetryableError,
};

export const lmStudioChatCompletionsUrl = openAiCompatibleChatCompletionsUrl;

export function createLmStudioModelProvider(input: { baseUrl: string; model: string }) {
	return createOpenAiCompatibleModelProvider({
		execution: "local_inference",
		baseUrl: input.baseUrl,
		requestedModel: input.model,
	});
}
