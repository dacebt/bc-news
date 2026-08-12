import { z } from "zod";

const NonBlankStringSchema = z.string().trim().min(1);

export const CloudflareAiGatewayModelSchema = NonBlankStringSchema.refine((model) => {
	const segments = model.split("/");
	if (segments.some((segment) => segment === "" || /\s/u.test(segment))) return false;
	return model.startsWith("@cf/")
		? segments.length === 3 && segments[0] === "@cf"
		: segments.length === 2 && !segments[0]!.startsWith("@");
}, "Cloudflare AI Gateway model must use author/model or @cf/author/model");

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

export const CloudflareAiGatewaySelectionSchema = z.strictObject({
	selection: z.literal("named"),
	id: NonBlankStringSchema,
});

export const CloudflareAiGatewayAdapterConfigSchema = z.strictObject({
	adapter: z.literal("cloudflare_ai_gateway"),
	gateway: CloudflareAiGatewaySelectionSchema.optional(),
	model: CloudflareAiGatewayModelSchema,
	temperature: ModelTemperatureSchema.optional(),
}).superRefine((config, context) => {
	if (config.model.startsWith("@cf/") && config.gateway === undefined) {
		context.addIssue({
			code: "custom",
			path: ["gateway"],
			message: "Cloudflare Workers AI models require a named AI Gateway",
		});
	}
});

export type LmStudioAdapterConfig = z.infer<typeof LmStudioAdapterConfigSchema>;
export type ModelTemperature = z.infer<typeof ModelTemperatureSchema>;
export type LmStudioReasoningEffort = z.infer<typeof LmStudioReasoningEffortSchema>;
export type HostedModelAdapterConfig = z.infer<typeof HostedModelAdapterConfigSchema>;
export type CalculatedBillingConfig = z.infer<typeof CalculatedBillingConfigSchema>;
export type CloudflareAiGatewaySelection = z.infer<typeof CloudflareAiGatewaySelectionSchema>;
export type CloudflareAiGatewayAdapterConfig = z.infer<typeof CloudflareAiGatewayAdapterConfigSchema>;
