import { z } from "zod";
import type { EvidenceInputPort } from "@bc-news/generation-core";
import { fixtureEvidenceInput } from "@bc-news/fixtures";
import { d1ChatEvidenceInput } from "./d1-chat-evidence";

export const EvidenceAdapterIdSchema = z.enum(["fixture", "d1_chat"]);
export type EvidenceAdapterId = z.infer<typeof EvidenceAdapterIdSchema>;

// Factories, not instances: the D1-backed adapter constructs from env
// bindings, so every entry takes env even when (like fixture) it ignores it.
export const evidenceAdapterFactories: Record<EvidenceAdapterId, (env: Env) => EvidenceInputPort> = {
	fixture: () => fixtureEvidenceInput,
	d1_chat: (env) => d1ChatEvidenceInput(env.DB),
};
