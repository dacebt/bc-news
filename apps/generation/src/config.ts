import { z } from "zod";
import type {
	EditorialCapability,
	EvidenceInputPort,
	ModelProviderPort,
} from "@bc-news/generation-core";
import { EvidenceAdapterIdSchema, evidenceAdapterFactories } from "./adapters/evidence-adapters";
import { ModelAdapterConfigSchema, resolveModelProvider } from "./adapters/model-adapters";

const ModelConfigSchema = z.strictObject({
	main_story: ModelAdapterConfigSchema,
	announcements: ModelAdapterConfigSchema,
	packaging: ModelAdapterConfigSchema,
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

export class GenerationConfigError extends Error {
	readonly code = "invalid_generation_config";

	constructor(message: string) {
		super(message);
		this.name = "GenerationConfigError";
	}
}

export interface GenerationPorts {
	evidenceInput: EvidenceInputPort;
	modelProviders: Record<EditorialCapability, ModelProviderPort>;
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
			main_story: resolveModelProvider("main_story", MODEL_CONFIG.main_story, env),
			announcements: resolveModelProvider("announcements", MODEL_CONFIG.announcements, env),
			packaging: resolveModelProvider("packaging", MODEL_CONFIG.packaging, env),
		},
	};
}
