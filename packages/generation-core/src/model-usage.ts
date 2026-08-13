import { z } from "zod";
import type { ModelCompletion, ModelUsageRecord, ProductionModelStep } from "./ports";

export const EditorialProductSchema = z.enum(["main_story", "announcements"]);

export const PRODUCTION_MODEL_STEPS = [
	"main_story_write",
	"main_story_copyedit",
	"announcements_write",
	"announcements_copyedit",
] as const satisfies readonly ProductionModelStep[];

export const ProductionModelStepSchema = z.enum(PRODUCTION_MODEL_STEPS);

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

export const ModelRequestCorrelationSchema = z.strictObject({
	run_id: z.string().trim().min(1),
	invocation_id: z.string().trim().min(1),
});

export const ModelRequestProvenanceSchema = z.discriminatedUnion("transport", [
	z.strictObject({
		transport: z.literal("cloudflare_ai_gateway_rest"),
		account_id: z.string().trim().min(1),
		gateway: z.union([
			z.strictObject({ selection: z.literal("named"), id: z.string().trim().min(1) }),
			z.strictObject({ selection: z.literal("account_default") }),
		]),
		gateway_log_id: z.union([
			z.string().trim().min(1),
			z.strictObject({ state: z.literal("unavailable"), reason: z.literal("provider_did_not_report") }),
		]),
		requested_model: z.string().trim().min(1),
		correlation: ModelRequestCorrelationSchema,
		policy: z.strictObject({
			cache: z.literal("bypass"),
			log_metadata: z.literal(true),
			log_payload: z.literal(false),
			max_attempts: z.literal(1),
			request_timeout_ms: z.number().int().positive(),
			request_format: z.literal("chat_completions").optional(),
			structured_output: z.strictObject({
				format: z.literal("openai_chat_json_schema"),
				contract_name: z.string().trim().min(1),
			}).optional(),
			output_tokens: z.strictObject({
				field: z.enum(["max_tokens", "max_completion_tokens"]),
				limit: z.number().int().positive(),
			}).optional(),
		}),
	}),
]);

export const ModelUsageRecordSchema = z.strictObject({
	production_step: ProductionModelStepSchema,
	provider: z.string().trim().min(1),
	model: z.string().trim().min(1),
	execution: z.enum(["recorded_replay", "local_inference", "hosted_inference"]),
	token_usage: TokenUsageSchema,
	external_billing: ExternalBillingSchema,
	request_provenance: ModelRequestProvenanceSchema.optional(),
});

export const ProductionModelUsageRosterSchema = z
	.array(ModelUsageRecordSchema)
	.length(PRODUCTION_MODEL_STEPS.length)
	.superRefine((usages, context) => {
		for (const [index, productionStep] of PRODUCTION_MODEL_STEPS.entries()) {
			if (usages[index]?.production_step !== productionStep) {
				context.addIssue({
					code: "custom",
					path: [index, "production_step"],
					message: `Expected ${productionStep} at production usage index ${index}`,
				});
			}
		}
	});

export function modelUsageRecord(
	productionStep: ProductionModelStep,
	completion: ModelCompletion,
): ModelUsageRecord {
	return {
		production_step: productionStep,
		provider: completion.provider,
		model: completion.model,
		execution: completion.execution,
		token_usage: completion.token_usage,
		external_billing: completion.external_billing,
		...(completion.request_provenance === undefined ? {} : { request_provenance: completion.request_provenance }),
	};
}
