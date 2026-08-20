import { z } from "zod";
import { ExternalBillingSchema, TokenUsageSchema } from "@bc-news/generation-core";
import {
	EvaluationIdSchema,
	EvaluationTimestampSchema,
	Sha256HashSchema,
	sha256Json,
} from "./evaluation-artifact-schemas";

export const LEGACY_PRODUCTION_MODEL_STEPS = [
	"main_story_write",
	"main_story_copyedit",
	"announcements_write",
	"announcements_copyedit",
] as const;

export const LegacyProductionModelStepSchema = z.enum(
	LEGACY_PRODUCTION_MODEL_STEPS,
);
export type LegacyProductionModelStep =
	(typeof LEGACY_PRODUCTION_MODEL_STEPS)[number];

export const LegacyEvaluationFindingSchema = z.strictObject({
	kind: z.enum([
		"invalid_json",
		"contract_mismatch",
		"preservation",
		"final_product",
	]),
	production_step: LegacyProductionModelStepSchema,
	code: z.string().min(1),
	message: z.string().min(1),
});

const RetainedRequestSchema = z.strictObject({
	production_step: LegacyProductionModelStepSchema,
	system: z.string(),
	user: z.string(),
});

const ModelCompletionSchema = z.strictObject({
	text: z.string().nullable(),
	provider: z.string().min(1),
	model: z.string().min(1),
	execution: z.enum([
		"recorded_replay",
		"local_inference",
		"hosted_inference",
	]),
	token_usage: TokenUsageSchema,
	external_billing: ExternalBillingSchema,
});

const ParsePendingSchema = z.strictObject({ state: z.literal("pending") });
const ParseSucceededSchema = z.strictObject({
	state: z.literal("succeeded"),
	output: z.record(z.string(), z.unknown()),
});
const ParseRejectedSchema = z.strictObject({
	state: z.literal("rejected"),
	findings: z.array(LegacyEvaluationFindingSchema).min(1),
});
const ParseStateSchema = z.discriminatedUnion("state", [
	ParsePendingSchema,
	ParseSucceededSchema,
	ParseRejectedSchema,
]);

const InvocationBase = {
	id: EvaluationIdSchema,
	production_step: LegacyProductionModelStepSchema,
	config_identity: EvaluationIdSchema,
	ordinal: z.number().int().positive(),
	predecessor_invocation_id: EvaluationIdSchema.nullable(),
	request: RetainedRequestSchema,
	request_sha256: Sha256HashSchema,
	started_at: EvaluationTimestampSchema,
};

const InFlightInvocationSchema = z.strictObject({
	...InvocationBase,
	transport: z.literal("in_flight"),
	parse: ParsePendingSchema,
});

const SucceededInvocationSchema = z.strictObject({
	...InvocationBase,
	transport: z.literal("succeeded"),
	completion: ModelCompletionSchema,
	ended_at: EvaluationTimestampSchema,
	duration_ms: z.number().int().nonnegative(),
	parse: ParseStateSchema,
});

const FailedInvocationSchema = z.strictObject({
	...InvocationBase,
	transport: z.literal("failed"),
	failure: z.strictObject({
		code: z.string().min(1),
		message: z.string().min(1),
		details: z.unknown().optional(),
	}),
	ended_at: EvaluationTimestampSchema,
	duration_ms: z.number().int().nonnegative(),
	retry_classification: z.discriminatedUnion("state", [
		z.strictObject({ state: z.literal("pending") }),
		z.strictObject({
			state: z.literal("classified"),
			eligible: z.boolean(),
			reason: z.string().min(1),
		}),
	]),
	parse: ParsePendingSchema,
});

export const LegacyStepInvocationSchema = z
	.discriminatedUnion("transport", [
		InFlightInvocationSchema,
		SucceededInvocationSchema,
		FailedInvocationSchema,
	])
	.superRefine((invocation, context) => {
		if (invocation.request.production_step !== invocation.production_step) {
			context.addIssue({
				code: "custom",
				path: ["request", "production_step"],
				message: "retained request must name the invocation production step",
			});
		}
		if (invocation.request_sha256 !== sha256Json(invocation.request)) {
			context.addIssue({
				code: "custom",
				path: ["request_sha256"],
				message: "request hash must bind the exact retained request",
			});
		}
		if (invocation.transport === "in_flight") {
			return;
		}
		const startedAt = Date.parse(invocation.started_at);
		const endedAt = Date.parse(invocation.ended_at);
		if (endedAt < startedAt) {
			context.addIssue({
				code: "custom",
				path: ["ended_at"],
				message: "ended invocation cannot end before it starts",
			});
		}
		if (invocation.duration_ms !== endedAt - startedAt) {
			context.addIssue({
				code: "custom",
				path: ["duration_ms"],
				message:
					"duration must exactly equal the retained invocation endpoint difference",
			});
		}
	});

export const LegacyOutputContractProvenanceSchema = z.strictObject({
	production_step: LegacyProductionModelStepSchema,
	canonical_schema: z.json(),
	schema_sha256: Sha256HashSchema,
});

export const LEGACY_OUTPUT_CONTRACT_NAMES = {
	main_story_write: "main_story_write_output",
	main_story_copyedit: "main_story_copyedit_output",
	announcements_write: "announcements_write_output",
	announcements_copyedit: "announcements_copyedit_output",
} as const satisfies Record<LegacyProductionModelStep, string>;

export type LegacyStepInvocation = z.infer<typeof LegacyStepInvocationSchema>;
