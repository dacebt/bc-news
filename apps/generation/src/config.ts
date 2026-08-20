import { z } from "zod";
import type {
	EvidenceInputPort,
	ModelProviderPort,
} from "@bc-news/generation-core";
import { EvidenceAdapterIdSchema, evidenceAdapterFactories } from "./adapters/evidence-adapters";
import { ModelAdapterConfigSchema, resolveModelProvider } from "./adapters/model-adapters";
import { GenerationConfigError } from "./config-error";

export const GENERATION_WRITER_STEPS = [
	"main_story_write",
	"announcements_write",
] as const;

export type GenerationWriterStep = (typeof GENERATION_WRITER_STEPS)[number];

export const ModelConfigSchema = z.strictObject({
	main_story_write: ModelAdapterConfigSchema,
	announcements_write: ModelAdapterConfigSchema,
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
	modelProviders: Record<GenerationWriterStep, ModelProviderPort>;
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
			announcements_write: resolveModelProvider("announcements_write", MODEL_CONFIG.announcements_write, env),
		},
	};
}
