import { z } from "zod";
import type { EvidenceInputPort } from "@bc-news/generation-core";
import { fixtureEvidenceInput } from "@bc-news/fixtures";

export const EvidenceAdapterIdSchema = z.enum(["fixture"]);
export type EvidenceAdapterId = z.infer<typeof EvidenceAdapterIdSchema>;

// Factories, not instances: a later D1-backed adapter constructs from env
// bindings, so every entry takes env even when (like fixture) it ignores it.
export const evidenceAdapterFactories: Record<EvidenceAdapterId, (env: Env) => EvidenceInputPort> = {
	fixture: () => fixtureEvidenceInput,
};
