import { z } from "zod";
import type { EditorialCapability, ModelProviderPort } from "@bc-news/generation-core";
import { recordedJudgeModelProvider, recordedModelProvider } from "@bc-news/fixtures";

/**
 * Mirrors apps/generation/src/adapters/model-adapters.ts's discriminated-union
 * shape for ModelAdapterConfig, but the resolver signature is intentionally
 * narrower: no `env` parameter. The eval CLI runs outside a Worker, so there
 * is no Env to read hosted/lmstudio base URLs and secrets from, and `Env` is
 * not even nameable from this compilation unit (apps/eval/tsconfig.json has
 * no wrangler types). A later merge into a shared @bc-news/model-adapters
 * package is not a plain import swap for this resolver — the shared
 * signature will need to accommodate a caller with no `Env` to pass, or this
 * file will need to keep wrapping it locally.
 */
export const ModelAdapterConfigSchema = z.discriminatedUnion("adapter", [
	z.strictObject({ adapter: z.literal("recorded") }),
]);
export type ModelAdapterConfig = z.infer<typeof ModelAdapterConfigSchema>;

/**
 * `role` distinguishes producing a capability's output from judging it: both
 * resolve through this one function (one adapter home), but a "recorded"
 * adapter backs a different recorded response set per role. Adding a live
 * (e.g. lmstudio) adapter later is a new case in this switch, not a second
 * resolution path.
 */
export function resolveModelProvider(
	editorialCapability: EditorialCapability,
	config: ModelAdapterConfig,
	role: "capability" | "judge",
): ModelProviderPort {
	void editorialCapability;
	switch (config.adapter) {
		case "recorded":
			return role === "judge" ? recordedJudgeModelProvider : recordedModelProvider;
	}
}
