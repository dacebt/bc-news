import { z } from "zod";
import type {
	EvidenceInputPort,
	ModelProviderPort,
	ProductionModelStep,
} from "@bc-news/generation-core";
import { EvidenceAdapterIdSchema, evidenceAdapterFactories } from "./adapters/evidence-adapters";
import { ModelAdapterConfigSchema, resolveModelProvider } from "./adapters/model-adapters";
import { GenerationConfigError } from "./config-error";

export const ModelConfigSchema = z.strictObject({
	main_story_write: ModelAdapterConfigSchema,
	main_story_copyedit: ModelAdapterConfigSchema,
	announcements_write: ModelAdapterConfigSchema,
	announcements_copyedit: ModelAdapterConfigSchema,
});

const GenerationConfigVarsSchema = z.object({
	EVIDENCE_INPUT: EvidenceAdapterIdSchema,
	MODEL_CONFIG: z
		.string()
		.transform((raw, context) => {
			try {
				return JSON.parse(raw) as unknown;
			} catch {
				context.addIssue({ code: "custom", message: "MODEL_CONFIG is not valid JSON" });
				return z.NEVER;
			}
		})
		.pipe(ModelConfigSchema),
});

export { GenerationConfigError } from "./config-error";

export interface GenerationPorts {
	evidenceInput: EvidenceInputPort;
	modelProviders: Record<ProductionModelStep, ModelProviderPort>;
}

export function resolveGenerationPorts(env: Env): GenerationPorts {
	const result = GenerationConfigVarsSchema.safeParse(env);
	if (!result.success) {
		throw new GenerationConfigError(
			`Generation config vars rejected: ${result.error.message}`,
		);
	}
	const { EVIDENCE_INPUT, MODEL_CONFIG } = result.data;
	return {
		evidenceInput: evidenceAdapterFactories[EVIDENCE_INPUT](env),
		modelProviders: {
			main_story_write: resolveModelProvider("main_story_write", MODEL_CONFIG.main_story_write, env),
			main_story_copyedit: resolveModelProvider("main_story_copyedit", MODEL_CONFIG.main_story_copyedit, env),
			announcements_write: resolveModelProvider("announcements_write", MODEL_CONFIG.announcements_write, env),
			announcements_copyedit: resolveModelProvider("announcements_copyedit", MODEL_CONFIG.announcements_copyedit, env),
		},
	};
}
