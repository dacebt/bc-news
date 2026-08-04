import { z } from "zod";
import type { EditorialCapability, ModelProviderPort } from "@bc-news/generation-core";
import { recordedModelProvider } from "@bc-news/fixtures";

export const ModelAdapterConfigSchema = z.discriminatedUnion("adapter", [
	z.strictObject({ adapter: z.literal("recorded") }),
]);
export type ModelAdapterConfig = z.infer<typeof ModelAdapterConfigSchema>;

// editorialCapability and env are part of the frozen signature: later
// adapters (hosted, lmstudio) read base URLs/secrets from env and vary by
// capability; recorded ignores both.
export function resolveModelProvider(
	editorialCapability: EditorialCapability,
	config: ModelAdapterConfig,
	env: Env,
): ModelProviderPort {
	void env;
	switch (config.adapter) {
		case "recorded":
			return recordedModelProvider;
	}
}
