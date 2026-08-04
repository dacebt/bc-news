import { z } from "zod";
import type { EvidenceInputPort, ModelProviderPort } from "@bc-news/generation-core";
import { fixtureEvidenceInput, recordedModelProvider } from "@bc-news/fixtures";

const ModelConfigSchema = z.strictObject({
	main_story: z.strictObject({
		adapter: z.literal("recorded"),
	}),
});

const GenerationConfigVarsSchema = z.object({
	EVIDENCE_INPUT: z.literal("fixture"),
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
	modelProviders: { main_story: ModelProviderPort };
}

export function resolveGenerationPorts(env: Env): GenerationPorts {
	const result = GenerationConfigVarsSchema.safeParse(env);
	if (!result.success) {
		throw new GenerationConfigError(
			`Generation config vars rejected: ${result.error.message}`,
		);
	}
	return {
		evidenceInput: fixtureEvidenceInput,
		modelProviders: { main_story: recordedModelProvider },
	};
}
