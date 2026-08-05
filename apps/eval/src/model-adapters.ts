import { z } from "zod";
import type { EditorialCapability, ModelProviderPort } from "@bc-news/generation-core";
import { recordedJudgeModelProvider, recordedModelProvider } from "@bc-news/fixtures";
import {
	HostedModelAdapterConfigSchema,
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

/**
 * `role` distinguishes producing a capability's output from judging it: both
 * resolve through this one function (one adapter home), but a "recorded"
 * adapter backs a different recorded response set per role. Local and hosted
 * adapters share the same transport while retaining this role-aware resolver.
 */
export function resolveModelProvider(
	editorialCapability: EditorialCapability,
	config: ModelAdapterConfig,
	role: "capability" | "judge",
	environment: ModelProviderEnvironment,
): ModelProviderPort {
	switch (config.adapter) {
		case "recorded":
			return role === "judge" ? recordedJudgeModelProvider : recordedModelProvider;
		case "lmstudio": {
			const baseUrl = environment.LMSTUDIO_BASE_URL;
			if (baseUrl === undefined || baseUrl === "") {
				throw new OpenAiCompatibleDeterministicError(
					"openai_compatible_invalid_config",
					`LMSTUDIO_BASE_URL is required for ${role} ${editorialCapability}`,
				);
			}
			return createOpenAiCompatibleModelProvider({
				execution: "local_inference",
				baseUrl,
				requestedModel: config.model,
			});
		}
		case "openai_compatible_hosted": {
			const baseUrl = environment.HOSTED_MODEL_BASE_URL;
			const apiKey = environment.HOSTED_MODEL_API_KEY;
			if (baseUrl === undefined || baseUrl === "" || apiKey === undefined || apiKey === "") {
				throw new OpenAiCompatibleDeterministicError(
					"openai_compatible_invalid_config",
					`HOSTED_MODEL_BASE_URL and HOSTED_MODEL_API_KEY are required for ${role} ${editorialCapability}`,
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
