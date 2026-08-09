import { z } from "zod";
import { ProductionModelStepSchema } from "@bc-news/generation-core";

const RecordedModelResponseShape = {
	production_step: ProductionModelStepSchema,
	provider: z.string().min(1),
	model: z.string().min(1),
	prompt_sha256: z.string().regex(/^[0-9a-f]{64}$/),
	text: z.string().min(1),
} as const;

const LegacyRecordedModelResponseSchema = z.strictObject({
	...RecordedModelResponseShape,
});

const RecordedLmStudioSamplingConfigSchema = z.strictObject({
	temperature: z.number().finite().min(0).max(2),
	top_p: z.number().finite().min(0).max(1),
	top_k: z.number().int().nonnegative(),
});

const RecordedModelSamplingSchema = z.discriminatedUnion("posture", [
	z.strictObject({
		adapter: z.literal("lmstudio"),
		posture: z.literal("provider_default"),
	}),
	z.strictObject({
		adapter: z.literal("lmstudio"),
		posture: z.literal("explicit"),
		config: RecordedLmStudioSamplingConfigSchema,
	}),
	z.strictObject({
		adapter: z.literal("openai_compatible_hosted"),
		posture: z.literal("not_applicable"),
	}),
]);

export const RecordedModelResponseV2Schema = z.strictObject({
	version: z.literal(2),
	...RecordedModelResponseShape,
	sampling: RecordedModelSamplingSchema,
});

export const RecordedModelResponseSchema = z.union([
	RecordedModelResponseV2Schema,
	LegacyRecordedModelResponseSchema,
]);

export type RecordedModelSampling = z.infer<typeof RecordedModelSamplingSchema>;
export type RecordedModelResponseV2 = z.infer<typeof RecordedModelResponseV2Schema>;
export type RecordedModelResponse = z.infer<typeof RecordedModelResponseSchema>;

type RecordedModelProviderErrorCode =
	| "unknown_production_step"
	| "recorded_response_step_mismatch"
	| "recorded_response_prompt_mismatch";

export class RecordedModelProviderError extends Error {
	readonly code: RecordedModelProviderErrorCode;
	readonly productionStep: string;

	constructor(
		code: RecordedModelProviderErrorCode,
		productionStep: string,
		message: string,
	) {
		super(message);
		this.name = "RecordedModelProviderError";
		this.code = code;
		this.productionStep = productionStep;
	}
}
