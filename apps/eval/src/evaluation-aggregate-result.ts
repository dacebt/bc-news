import { z } from "zod";
import { CloudflareAiGatewayModelSchema, LmStudioReasoningEffortSchema, ModelTemperatureSchema } from "@bc-news/model-adapters";
import { EvaluationIdSchema, EvaluationTimestampSchema } from "./evaluation-artifact-schemas";

const NonBlankStringSchema = z.string().trim().min(1);
const NonnegativeSchema = z.number().int().nonnegative();
const Sha256HashSchema = z.string().regex(/^[0-9a-f]{64}$/u);

export const EVALUATION_AGGREGATE_RESULT_ERROR_CODES = [
	"unsupported_source_scorecard_version",
	"aggregate_creation_rejected",
	"aggregate_chronology_mismatch",
	"aggregate_role_roster_mismatch",
	"aggregate_rate_roster_mismatch",
	"aggregate_distribution_roster_mismatch",
	"aggregate_qualitative_roster_mismatch",
	"aggregate_artifact_tampered",
	"invalid_aggregate_result_id",
	"aggregate_result_not_found",
	"aggregate_result_malformed",
	"aggregate_result_invalid",
	"aggregate_result_filename_mismatch",
	"aggregate_result_create_rejected",
] as const;
export type EvaluationAggregateResultErrorCode = typeof EVALUATION_AGGREGATE_RESULT_ERROR_CODES[number];

export class EvaluationAggregateResultError extends Error {
	readonly code: EvaluationAggregateResultErrorCode;
	readonly path: string;

	constructor(code: EvaluationAggregateResultErrorCode, path: string, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "EvaluationAggregateResultError";
		this.code = code;
		this.path = path;
	}
}

const SubjectDescriptorSchema = z.discriminatedUnion("adapter", [
	z.strictObject({ adapter: z.literal("recorded") }),
	z.strictObject({
		adapter: z.literal("lmstudio"),
		model: NonBlankStringSchema,
		temperature: ModelTemperatureSchema.optional(),
		reasoning_effort: LmStudioReasoningEffortSchema,
	}),
	z.strictObject({
		adapter: z.literal("openai_compatible_hosted"),
		provider: NonBlankStringSchema,
		model: NonBlankStringSchema,
		temperature: ModelTemperatureSchema.optional(),
	}),
	z.strictObject({
		adapter: z.literal("cloudflare_ai_gateway"),
		model: CloudflareAiGatewayModelSchema,
		temperature: ModelTemperatureSchema.optional(),
	}),
]);
export type EvaluationAggregateSubjectDescriptor = z.infer<typeof SubjectDescriptorSchema>;

const SampleCountsSchema = z.strictObject({
	declared_trial_count: NonnegativeSchema,
	step_reached_trial_count: NonnegativeSchema,
	step_not_reached_trial_count: NonnegativeSchema,
	invocation_attempt_count: NonnegativeSchema,
	initial_attempt_count: NonnegativeSchema,
	retry_attempt_count: NonnegativeSchema,
	transport_failed_attempt_count: NonnegativeSchema,
	transport_succeeded_attempt_count: NonnegativeSchema,
	parse_succeeded_invocation_count: NonnegativeSchema,
	parse_rejected_invocation_count: NonnegativeSchema,
	annotated_output_count: NonnegativeSchema,
	reviewed_output_count: NonnegativeSchema,
});

function rateSchema(metric: string, denominatorUnit: string) {
	return z.discriminatedUnion("state", [
		z.strictObject({
			state: z.literal("measured"),
			metric: z.literal(metric),
			unit: z.literal("ratio"),
			denominator_unit: z.literal(denominatorUnit),
			numerator: NonnegativeSchema,
			denominator: z.number().int().positive(),
			sample_count: z.number().int().positive(),
			value: z.number().finite().min(0).max(1),
			interval: z.strictObject({
				confidence: z.literal(0.95),
				method: z.literal("wilson_score"),
				lower: z.number().finite().min(0).max(1),
				upper: z.number().finite().min(0).max(1),
			}),
		}),
		z.strictObject({
			state: z.literal("not_applicable"),
			metric: z.literal(metric),
			unit: z.literal("ratio"),
			denominator_unit: z.literal(denominatorUnit),
			reason: z.enum(["role_not_applicable", "zero_denominator"]),
			numerator: z.literal(0),
			denominator: z.literal(0),
			sample_count: z.literal(0),
			interval: z.strictObject({ state: z.literal("not_applicable") }),
		}),
	]);
}

function distributionSchema(metric: string, unit: "tokens" | "milliseconds") {
	return z.strictObject({
		metric: z.literal(metric),
		unit: z.literal(unit),
		sample_count: NonnegativeSchema,
		observed_sample_count: NonnegativeSchema,
		unavailable_sample_count: NonnegativeSchema,
		summary: z.union([
			z.strictObject({
				state: z.literal("measured"),
				min: z.number().finite().nonnegative(),
				median: z.number().finite().nonnegative(),
				mean: z.number().finite().nonnegative(),
				max: z.number().finite().nonnegative(),
			}),
			z.strictObject({ state: z.literal("unavailable") }),
		]),
	});
}

function qualitativeSchema(criterion: string) {
	return z.strictObject({
		criterion: z.literal(criterion),
		unit: z.literal("review_assessment"),
		sample_unit: z.literal("codex_reviewed_output"),
		sample_count: NonnegativeSchema,
		counts: z.strictObject({
			meets: NonnegativeSchema,
			partly_meets: NonnegativeSchema,
			does_not_meet: NonnegativeSchema,
			uncertain: NonnegativeSchema,
		}),
	});
}

function historicalRoleSchema(productionStep: "main_story_write" | "main_story_copyedit" | "announcements_write" | "announcements_copyedit") {
	return z.strictObject({
		production_step: z.literal(productionStep),
		subject: SubjectDescriptorSchema,
		sample_counts: SampleCountsSchema,
		rates: z.tuple([
			rateSchema("schema_reliability", "terminal_provider_success_invocation"),
			rateSchema("copyedit_preservation", "parse_success_copyedit_output"),
			rateSchema("claim_grounding", "codex_annotated_factual_claim"),
			rateSchema("required_attribution", "codex_annotated_required_attribution_claim"),
			rateSchema("event_coverage", "source_event_output_pair"),
			rateSchema("announcement_relevance", "parsed_announcement"),
		]),
		distributions: z.tuple([
			distributionSchema("input_tokens", "tokens"),
			distributionSchema("output_tokens", "tokens"),
			distributionSchema("total_tokens", "tokens"),
			distributionSchema("application_latency_ms", "milliseconds"),
			distributionSchema("provider_time_to_first_token_ms", "milliseconds"),
			distributionSchema("provider_total_time_ms", "milliseconds"),
		]),
		qualitative: z.tuple([
			qualitativeSchema("coherence"),
			qualitativeSchema("usefulness"),
			qualitativeSchema("newsworthiness"),
			qualitativeSchema("voice"),
		]),
	});
}

function currentRoleSchema(productionStep: "main_story_write" | "announcements_write") {
	return z.strictObject({
		production_step: z.literal(productionStep),
		subject: SubjectDescriptorSchema,
		sample_counts: SampleCountsSchema,
		rates: z.tuple([
			rateSchema("schema_reliability", "terminal_provider_success_invocation"),
			rateSchema("claim_grounding", "codex_annotated_factual_claim"),
			rateSchema("required_attribution", "codex_annotated_required_attribution_claim"),
			rateSchema("event_coverage", "source_event_output_pair"),
			rateSchema("announcement_relevance", "parsed_announcement"),
		]),
		distributions: z.tuple([
			distributionSchema("input_tokens", "tokens"),
			distributionSchema("output_tokens", "tokens"),
			distributionSchema("total_tokens", "tokens"),
			distributionSchema("application_latency_ms", "milliseconds"),
			distributionSchema("provider_time_to_first_token_ms", "milliseconds"),
			distributionSchema("provider_total_time_ms", "milliseconds"),
		]),
		qualitative: z.tuple([
			qualitativeSchema("coherence"),
			qualitativeSchema("usefulness"),
			qualitativeSchema("newsworthiness"),
			qualitativeSchema("voice"),
		]),
	});
}

const HistoricalRolesSchema = z.tuple([
	historicalRoleSchema("main_story_write"),
	historicalRoleSchema("main_story_copyedit"),
	historicalRoleSchema("announcements_write"),
	historicalRoleSchema("announcements_copyedit"),
]);
const CurrentRolesSchema = z.tuple([
	currentRoleSchema("main_story_write"),
	currentRoleSchema("announcements_write"),
]);

const AggregateBaseSchema = z.strictObject({
	id: EvaluationIdSchema,
	created_at: EvaluationTimestampSchema,
	evidence_retention: z.literal("local_only"),
});

const HistoricalAggregateBaseSchema = AggregateBaseSchema.extend({
	configuration_identity: EvaluationIdSchema,
	roles: HistoricalRolesSchema,
});
const CurrentAggregateBaseSchema = AggregateBaseSchema.extend({
	configuration_identity: EvaluationIdSchema,
	roles: CurrentRolesSchema,
});

export const EvaluationAggregateResultV1Schema = HistoricalAggregateBaseSchema.extend({
	version: z.literal(1),
	source_scorecard: z.strictObject({
		version: z.literal(2),
		id: EvaluationIdSchema,
		created_at: EvaluationTimestampSchema,
	}),
	cohort: z.strictObject({
		id: EvaluationIdSchema,
		fixture_count: z.number().int().positive(),
		repetition_count: z.number().int().positive(),
		raw_message_count: NonnegativeSchema.optional(),
		prepared_message_count: NonnegativeSchema.optional(),
	}),
});
export type EvaluationAggregateResultV1 = z.infer<typeof EvaluationAggregateResultV1Schema>;

export const EvaluationAggregateResultV2Schema = HistoricalAggregateBaseSchema.extend({
	version: z.literal(2),
	source_scorecard: z.strictObject({
		version: z.literal(3),
		id: EvaluationIdSchema,
		created_at: EvaluationTimestampSchema,
	}),
	cohort: z.strictObject({
		id: EvaluationIdSchema,
		evidence_identity_sha256: Sha256HashSchema,
		fixture_count: z.number().int().positive(),
		repetition_count: z.number().int().positive(),
		raw_message_count: NonnegativeSchema.optional(),
		prepared_message_count: NonnegativeSchema.optional(),
	}),
});
export type EvaluationAggregateResultV2 = z.infer<typeof EvaluationAggregateResultV2Schema>;

export const EvaluationAggregateResultSchema = CurrentAggregateBaseSchema.extend({
	version: z.literal(3),
	source_scorecard: z.strictObject({
		version: z.literal(4),
		id: EvaluationIdSchema,
		created_at: EvaluationTimestampSchema,
		benchmark_run_version: z.literal(9),
		annotation_protocol: z.strictObject({
			id: NonBlankStringSchema,
			version: z.literal(3),
		}),
		qualitative_rubric: z.strictObject({
			id: NonBlankStringSchema,
			version: z.literal(3),
		}),
	}),
	cohort: z.strictObject({
		id: EvaluationIdSchema,
		evidence_identity_sha256: Sha256HashSchema,
		fixture_count: z.number().int().positive(),
		repetition_count: z.number().int().positive(),
		raw_message_count: NonnegativeSchema.optional(),
		prepared_message_count: NonnegativeSchema.optional(),
	}),
});
export type EvaluationAggregateResult = z.infer<typeof EvaluationAggregateResultSchema>;

export const AnyEvaluationAggregateResultSchema = z.discriminatedUnion("version", [
	EvaluationAggregateResultV1Schema,
	EvaluationAggregateResultV2Schema,
	EvaluationAggregateResultSchema,
]);
export type AnyEvaluationAggregateResult = z.infer<typeof AnyEvaluationAggregateResultSchema>;
