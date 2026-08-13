import { z } from "zod";
import type { ModelProviderPort, ProductionModelStep } from "@bc-news/generation-core";
import { recordedModelProvider } from "@bc-news/fixtures";
import {
	CloudflareAiGatewayAdapterConfigSchema,
	CloudflareAiGatewayDeterministicError,
	HostedModelAdapterConfigSchema,
	PRODUCTION_STEP_OUTPUT_CONTRACTS,
	LmStudioDeterministicError,
	LmStudioAdapterConfigSchema,
	OpenAiCompatibleDeterministicError,
	createOpenAiCompatibleModelProvider,
	createCloudflareAiGatewayModelProvider,
} from "@bc-news/model-adapters";
import { GenerationConfigError } from "../config-error";
import { createLmStudioModelProvider } from "./lmstudio-model-provider";

export const ModelAdapterConfigSchema = z.discriminatedUnion("adapter", [
	z.strictObject({ adapter: z.literal("recorded") }),
	LmStudioAdapterConfigSchema,
	HostedModelAdapterConfigSchema,
	CloudflareAiGatewayAdapterConfigSchema,
]);
export type ModelAdapterConfig = z.infer<typeof ModelAdapterConfigSchema>;

export function resolveModelProvider(
	productionStep: ProductionModelStep,
	config: ModelAdapterConfig,
	env: object,
): ModelProviderPort {
	const readEnv = (name: string): string | undefined => {
		const value: unknown = Reflect.has(env, name) ? Reflect.get(env, name) : undefined;
		return typeof value === "string" && value !== "" ? value : undefined;
	};
	const construct = (work: () => ModelProviderPort): ModelProviderPort => {
		try {
			return work();
		} catch (error) {
			if (
				error instanceof OpenAiCompatibleDeterministicError
				|| error instanceof CloudflareAiGatewayDeterministicError
				|| error instanceof LmStudioDeterministicError
			) {
				throw new GenerationConfigError(error.message, { cause: error });
			}
			throw error;
		}
	};
	switch (config.adapter) {
		case "recorded":
			return recordedModelProvider;
		case "lmstudio": {
			const baseUrl = readEnv("LMSTUDIO_BASE_URL");
			if (baseUrl === undefined) {
				throw new GenerationConfigError(
					`LMSTUDIO_BASE_URL is required for ${productionStep} when adapter is lmstudio`,
				);
			}
			return construct(() => createLmStudioModelProvider({
				baseUrl,
				model: config.model,
				...(config.temperature === undefined ? {} : { temperature: config.temperature }),
				reasoningEffort: config.reasoning_effort,
			}));
		}
		case "openai_compatible_hosted": {
			const baseUrl = readEnv("HOSTED_MODEL_BASE_URL");
			const apiKey = readEnv("HOSTED_MODEL_API_KEY");
			if (baseUrl === undefined || apiKey === undefined) {
				throw new GenerationConfigError(
					`HOSTED_MODEL_BASE_URL and HOSTED_MODEL_API_KEY are required for ${productionStep} when adapter is openai_compatible_hosted`,
				);
			}
			return construct(() => createOpenAiCompatibleModelProvider({
				execution: "hosted_inference",
				baseUrl,
				apiKey,
				provider: config.provider,
				requestedModel: config.model,
				...(config.temperature === undefined ? {} : { temperature: config.temperature }),
				billing: config.billing,
			}));
		}
		case "cloudflare_ai_gateway": {
			const accountId = readEnv("CLOUDFLARE_ACCOUNT_ID");
			const apiToken = readEnv("CLOUDFLARE_API_TOKEN");
			if (accountId === undefined || apiToken === undefined) {
				throw new GenerationConfigError(
					`CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required for ${productionStep} when adapter is cloudflare_ai_gateway`,
				);
			}
			return construct(() => createCloudflareAiGatewayModelProvider({
				accountId,
				apiToken,
				...(config.gateway === undefined ? {} : { gateway: config.gateway }),
				requestedModel: config.model,
				...(config.temperature === undefined ? {} : { temperature: config.temperature }),
				structuredOutputContracts: PRODUCTION_STEP_OUTPUT_CONTRACTS,
			}));
		}
	}
}
