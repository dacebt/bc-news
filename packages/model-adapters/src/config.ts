import { z } from "zod";

const NonBlankStringSchema = z.string().trim().min(1);

export const ModelTemperatureSchema = z.number().finite().min(0).max(2);

export const LmStudioReasoningEffortSchema = z.literal("provider_default");

export const LmStudioAdapterConfigSchema = z.strictObject({
	adapter: z.literal("lmstudio"),
	model: NonBlankStringSchema,
	temperature: ModelTemperatureSchema.optional(),
	reasoning_effort: LmStudioReasoningEffortSchema,
});

export const CalculatedBillingConfigSchema = z.strictObject({
	method: z.literal("calculated"),
	input_usd_per_million_tokens: z.number().finite().nonnegative(),
	output_usd_per_million_tokens: z.number().finite().nonnegative(),
	pricing_reference: NonBlankStringSchema,
});

export const HostedModelAdapterConfigSchema = z.strictObject({
	adapter: z.literal("openai_compatible_hosted"),
	provider: NonBlankStringSchema,
	model: NonBlankStringSchema,
	temperature: ModelTemperatureSchema.optional(),
	billing: CalculatedBillingConfigSchema,
});

export type LmStudioAdapterConfig = z.infer<typeof LmStudioAdapterConfigSchema>;
export type ModelTemperature = z.infer<typeof ModelTemperatureSchema>;
export type LmStudioReasoningEffort = z.infer<typeof LmStudioReasoningEffortSchema>;
export type HostedModelAdapterConfig = z.infer<typeof HostedModelAdapterConfigSchema>;
export type CalculatedBillingConfig = z.infer<typeof CalculatedBillingConfigSchema>;
