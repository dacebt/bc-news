import { z } from "zod";

const NonBlankStringSchema = z.string().trim().min(1);

export const LmStudioSamplingConfigSchema = z.strictObject({
	temperature: z.number().finite().min(0).max(2),
	top_p: z.number().finite().min(0).max(1),
	top_k: z.number().int().nonnegative(),
});

export const LmStudioReasoningEffortSchema = z.literal("provider_default");

export const LmStudioAdapterConfigSchema = z.strictObject({
	adapter: z.literal("lmstudio"),
	model: NonBlankStringSchema,
	sampling: LmStudioSamplingConfigSchema,
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
	billing: CalculatedBillingConfigSchema,
});

export type LmStudioAdapterConfig = z.infer<typeof LmStudioAdapterConfigSchema>;
export type LmStudioSamplingConfig = z.infer<typeof LmStudioSamplingConfigSchema>;
export type LmStudioReasoningEffort = z.infer<typeof LmStudioReasoningEffortSchema>;
export type HostedModelAdapterConfig = z.infer<typeof HostedModelAdapterConfigSchema>;
export type CalculatedBillingConfig = z.infer<typeof CalculatedBillingConfigSchema>;
