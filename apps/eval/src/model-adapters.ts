import { z } from "zod";
import type { ModelProviderPort, ProductionModelStep } from "@bc-news/generation-core";
import { recordedModelProvider } from "@bc-news/fixtures";
import {
	CloudflareAiGatewayAdapterConfigSchema,
	CloudflareAiGatewayDeterministicError,
	HostedModelAdapterConfigSchema,
	PRODUCTION_STEP_OUTPUT_CONTRACTS,
	LmStudioAdapterConfigSchema,
	LmStudioDeterministicError,
	OpenAiCompatibleDeterministicError,
	createLmStudioModelProvider,
	createCloudflareAiGatewayModelProvider,
	createOpenAiCompatibleModelProvider,
	lmStudioInferenceConfig,
} from "@bc-news/model-adapters";

export const ModelAdapterConfigSchema = z.discriminatedUnion("adapter", [
	z.strictObject({ adapter: z.literal("recorded") }),
	LmStudioAdapterConfigSchema,
	HostedModelAdapterConfigSchema,
	CloudflareAiGatewayAdapterConfigSchema,
]);
export type ModelAdapterConfig = z.infer<typeof ModelAdapterConfigSchema>;

export interface ModelProviderEnvironment {
	readonly LMSTUDIO_BASE_URL?: string;
	readonly HOSTED_MODEL_BASE_URL?: string;
	readonly HOSTED_MODEL_API_KEY?: string;
	readonly CF_ACCOUNT_ID?: string;
	readonly CF_AI_GATEWAY_API_TOKEN?: string;
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
				throw new LmStudioDeterministicError(
					"lmstudio_invalid_config",
					`LMSTUDIO_BASE_URL is required for ${productionStep}`,
				);
			}
			return createLmStudioModelProvider({
				baseUrl,
				requestedModel: config.model,
				inference: lmStudioInferenceConfig(config),
				reasoningEffort: config.reasoning_effort,
				structuredOutputContracts: PRODUCTION_STEP_OUTPUT_CONTRACTS,
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
				...(config.temperature === undefined ? {} : { temperature: config.temperature }),
				billing: config.billing,
			});
		}
		case "cloudflare_ai_gateway": {
			const accountId = environment.CF_ACCOUNT_ID;
			const apiToken = environment.CF_AI_GATEWAY_API_TOKEN;
			if (accountId === undefined || accountId === "" || apiToken === undefined || apiToken === "") {
				throw new CloudflareAiGatewayDeterministicError(
					"cloudflare_ai_gateway_invalid_config",
					`CF_ACCOUNT_ID and CF_AI_GATEWAY_API_TOKEN are required for ${productionStep}`,
				);
			}
			return createCloudflareAiGatewayModelProvider({
				accountId,
				apiToken,
				...(config.gateway === undefined ? {} : { gateway: config.gateway }),
				requestedModel: config.model,
				...(config.temperature === undefined ? {} : { temperature: config.temperature }),
				structuredOutputContracts: PRODUCTION_STEP_OUTPUT_CONTRACTS,
			});
		}
	}
}
