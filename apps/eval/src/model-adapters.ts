import { z } from "zod";
import type { ModelProviderPort, ProductionModelStep } from "@bc-news/generation-core";
import { recordedModelProvider } from "@bc-news/fixtures";
import {
	HostedModelAdapterConfigSchema,
	LM_STUDIO_PRODUCTION_STEP_OUTPUT_CONTRACTS,
	LmStudioAdapterConfigSchema,
	OpenAiCompatibleDeterministicError,
	createOpenAiCompatibleModelProvider,
} from "@bc-news/model-adapters";

export const ModelAdapterConfigSchema = z.discriminatedUnion("adapter", [
	z.strictObject({ adapter: z.literal("recorded") }),
	LmStudioAdapterConfigSchema,
	HostedModelAdapterConfigSchema,
]);
export type ModelAdapterConfig = z.infer<typeof ModelAdapterConfigSchema>;

export interface ModelProviderEnvironment {
	readonly LMSTUDIO_BASE_URL?: string;
	readonly HOSTED_MODEL_BASE_URL?: string;
	readonly HOSTED_MODEL_API_KEY?: string;
}

export function resolveModelProvider(
	productionStep: ProductionModelStep,
	config: ModelAdapterConfig,
	environment: ModelProviderEnvironment,
): ModelProviderPort {
	switch (config.adapter) {
		case "recorded":
			return recordedModelProvider;
		case "lmstudio": {
			const baseUrl = environment.LMSTUDIO_BASE_URL;
			if (baseUrl === undefined || baseUrl === "") {
				throw new OpenAiCompatibleDeterministicError(
					"openai_compatible_invalid_config",
					`LMSTUDIO_BASE_URL is required for ${productionStep}`,
				);
			}
			return createOpenAiCompatibleModelProvider({
				execution: "local_inference",
				baseUrl,
				requestedModel: config.model,
				sampling: config.sampling,
				reasoningEffort: config.reasoning_effort,
				structuredOutputContracts: LM_STUDIO_PRODUCTION_STEP_OUTPUT_CONTRACTS,
			});
		}
		case "openai_compatible_hosted": {
			const baseUrl = environment.HOSTED_MODEL_BASE_URL;
			const apiKey = environment.HOSTED_MODEL_API_KEY;
			if (baseUrl === undefined || baseUrl === "" || apiKey === undefined || apiKey === "") {
				throw new OpenAiCompatibleDeterministicError(
					"openai_compatible_invalid_config",
					`HOSTED_MODEL_BASE_URL and HOSTED_MODEL_API_KEY are required for ${productionStep}`,
				);
			}
			return createOpenAiCompatibleModelProvider({
				execution: "hosted_inference",
				baseUrl,
				apiKey,
				provider: config.provider,
				requestedModel: config.model,
				billing: config.billing,
			});
		}
	}
}
