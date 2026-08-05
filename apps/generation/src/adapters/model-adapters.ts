import { z } from "zod";
import type { EditorialCapability, ModelProviderPort } from "@bc-news/generation-core";
import { recordedModelProvider } from "@bc-news/fixtures";
import {
	HostedModelAdapterConfigSchema,
	LmStudioAdapterConfigSchema,
	OpenAiCompatibleDeterministicError,
	createOpenAiCompatibleModelProvider,
} from "@bc-news/model-adapters";
import { GenerationConfigError } from "../config-error";
import { createLmStudioModelProvider } from "./lmstudio-model-provider";

export const ModelAdapterConfigSchema = z.discriminatedUnion("adapter", [
	z.strictObject({ adapter: z.literal("recorded") }),
	LmStudioAdapterConfigSchema,
	HostedModelAdapterConfigSchema,
]);
export type ModelAdapterConfig = z.infer<typeof ModelAdapterConfigSchema>;

export function resolveModelProvider(
	editorialCapability: EditorialCapability,
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
			if (error instanceof OpenAiCompatibleDeterministicError) {
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
					`LMSTUDIO_BASE_URL is required for ${editorialCapability} when adapter is lmstudio`,
				);
			}
			return construct(() => createLmStudioModelProvider({
				baseUrl,
				model: config.model,
			}));
		}
		case "openai_compatible_hosted": {
			const baseUrl = readEnv("HOSTED_MODEL_BASE_URL");
			const apiKey = readEnv("HOSTED_MODEL_API_KEY");
			if (baseUrl === undefined || apiKey === undefined) {
				throw new GenerationConfigError(
					`HOSTED_MODEL_BASE_URL and HOSTED_MODEL_API_KEY are required for ${editorialCapability} when adapter is openai_compatible_hosted`,
				);
			}
			return construct(() => createOpenAiCompatibleModelProvider({
				execution: "hosted_inference",
				baseUrl,
				apiKey,
				provider: config.provider,
				requestedModel: config.model,
				billing: config.billing,
			}));
		}
	}
}
