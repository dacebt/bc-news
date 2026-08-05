import { z } from "zod";
import type { EditorialCapability, ModelCompletion, ModelUsageRecord } from "./ports";

export const EditorialCapabilitySchema = z.enum(["main_story", "announcements", "packaging"]);

export const TokenUsageSchema = z.discriminatedUnion("measurement", [
	z
		.strictObject({
			measurement: z.literal("reported"),
			input_tokens: z.int().nonnegative(),
			output_tokens: z.int().nonnegative(),
			total_tokens: z.int().nonnegative(),
		})
		.refine((usage) => usage.total_tokens === usage.input_tokens + usage.output_tokens, {
			message: "total_tokens must equal input_tokens plus output_tokens",
		}),
	z.strictObject({ measurement: z.literal("unavailable") }),
]);

export const ExternalBillingSchema = z.discriminatedUnion("classification", [
	z.strictObject({
		classification: z.literal("none"),
		amount_usd: z.literal(0),
		reason: z.enum(["recorded_replay", "local_inference"]),
	}),
	z.strictObject({
		classification: z.literal("provider_reported"),
		amount_usd: z.number().finite().nonnegative(),
	}),
	z.strictObject({
		classification: z.literal("calculated"),
		amount_usd: z.number().finite().nonnegative(),
		pricing_reference: z.string().trim().min(1),
	}),
	z.strictObject({
		classification: z.literal("unavailable"),
		reason: z.literal("provider_did_not_report_cost"),
	}),
]);

export const ModelUsageRecordSchema = z.strictObject({
	editorial_capability: EditorialCapabilitySchema,
	provider: z.string().trim().min(1),
	model: z.string().trim().min(1),
	execution: z.enum(["recorded_replay", "local_inference", "hosted_inference"]),
	token_usage: TokenUsageSchema,
	external_billing: ExternalBillingSchema,
});

export function modelUsageRecord(
	editorialCapability: EditorialCapability,
	completion: ModelCompletion,
): ModelUsageRecord {
	return {
		editorial_capability: editorialCapability,
		provider: completion.provider,
		model: completion.model,
		execution: completion.execution,
		token_usage: completion.token_usage,
		external_billing: completion.external_billing,
	};
}
