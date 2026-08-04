import { z } from "zod";
import type { EditorialCapability, ModelProviderPort } from "@bc-news/generation-core";
import { recordedModelProvider } from "@bc-news/fixtures";
import { GenerationConfigError } from "../config-error";
import { createLmStudioModelProvider } from "./lmstudio-model-provider";

export const ModelAdapterConfigSchema = z.discriminatedUnion("adapter", [
	z.strictObject({ adapter: z.literal("recorded") }),
	z.strictObject({
		adapter: z.literal("lmstudio"),
		model: z.string().min(1).refine((model) => model.trim().length > 0),
	}),
]);
export type ModelAdapterConfig = z.infer<typeof ModelAdapterConfigSchema>;

export function resolveModelProvider(
	editorialCapability: EditorialCapability,
	config: ModelAdapterConfig,
	env: object,
): ModelProviderPort {
	switch (config.adapter) {
		case "recorded":
			return recordedModelProvider;
		case "lmstudio": {
			const baseUrl = "LMSTUDIO_BASE_URL" in env ? env.LMSTUDIO_BASE_URL : undefined;
			if (typeof baseUrl !== "string" || baseUrl === "") {
				throw new GenerationConfigError(
					`LMSTUDIO_BASE_URL is required for ${editorialCapability} when adapter is lmstudio`,
				);
			}
			return createLmStudioModelProvider({
				baseUrl,
				model: config.model,
			});
		}
	}
}
