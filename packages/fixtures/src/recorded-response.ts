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

const RecordedModelTemperatureSchema = z.number().finite().min(0).max(2);
const RecordedLmStudioTopPSchema = z.number().finite().min(0).max(1);
const RecordedLmStudioTopKSchema = z.number().int().min(1).max(500);
const RecordedModelConfigurationSchema = z.discriminatedUnion("adapter", [
	z.strictObject({
		adapter: z.literal("lmstudio"),
		model: z.string().trim().min(1),
		temperature: RecordedModelTemperatureSchema.optional(),
		top_p: RecordedLmStudioTopPSchema.optional(),
		top_k: RecordedLmStudioTopKSchema.optional(),
		enable_thinking: z.boolean().optional(),
		reasoning_effort: z.literal("provider_default"),
	}),
	z.strictObject({
		adapter: z.literal("openai_compatible_hosted"),
		provider: z.string().trim().min(1),
		model: z.string().trim().min(1),
		temperature: RecordedModelTemperatureSchema.optional(),
		billing: z.strictObject({
			method: z.literal("calculated"),
			input_usd_per_million_tokens: z.number().finite().nonnegative(),
			output_usd_per_million_tokens: z.number().finite().nonnegative(),
			pricing_reference: z.string().trim().min(1),
		}),
	}),
]);

export const RecordedModelResponseV3Schema = z.strictObject({
	version: z.literal(3),
	...RecordedModelResponseShape,
	configuration: RecordedModelConfigurationSchema,
});

export const RecordedModelResponseSchema = z.union([
	RecordedModelResponseV3Schema,
	RecordedModelResponseV2Schema,
	LegacyRecordedModelResponseSchema,
]);

export type RecordedModelSampling = z.infer<typeof RecordedModelSamplingSchema>;
export type RecordedModelConfiguration = z.infer<typeof RecordedModelConfigurationSchema>;
export type RecordedModelResponseV2 = z.infer<typeof RecordedModelResponseV2Schema>;
export type RecordedModelResponseV3 = z.infer<typeof RecordedModelResponseV3Schema>;
export type RecordedModelResponse = z.infer<typeof RecordedModelResponseSchema>;

type RecordedModelProviderErrorCode =
	| "unknown_production_step"
	| "recorded_response_step_mismatch";

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
