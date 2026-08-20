import { z } from "zod";
import { isAbsolute, normalize } from "node:path";
import { ModelExecutionContextSchema } from "@bc-news/generation-core";
import { EvaluationIdSchema, EvaluationTimestampSchema } from "./evaluation-artifact-schemas";
import { V7ModelAdapterConfigSchema as V6ModelAdapterConfigSchema } from "./evaluation-artifact-v7";
import { LegacyProductionModelStepSchema as V1ProductionModelStepSchema } from "./evaluation-artifact-legacy-schemas";

const V1Sha256HashSchema = z.string().regex(/^[0-9a-f]{64}$/u);

export const EVALUATION_LONGITUDINAL_V1_ERROR_CODES = [
	"invalid_longitudinal_declaration_json", "longitudinal_declaration_rejected",
	"scorecard_source_unreadable", "scorecard_source_hash_mismatch", "scorecard_source_malformed",
	"scorecard_source_invalid", "scorecard_source_filename_mismatch", "longitudinal_evidence_set_mismatch",
	"longitudinal_chronology_mismatch", "cohort_projection_invalid", "series_artifact_tampered",
	"invalid_series_id", "series_not_found", "series_malformed", "series_invalid",
	"series_filename_mismatch", "series_create_rejected",
] as const;
export type EvaluationLongitudinalV1ErrorCode = typeof EVALUATION_LONGITUDINAL_V1_ERROR_CODES[number];

export class EvaluationLongitudinalV1Error extends Error {
	readonly code: EvaluationLongitudinalV1ErrorCode;
	readonly path: string;
	constructor(code: EvaluationLongitudinalV1ErrorCode, path: string, message: string, options?: ErrorOptions) {
		super(message, options); this.name = "EvaluationLongitudinalV1Error"; this.code = code; this.path = path;
	}
}

const Hash = V1Sha256HashSchema;
const Base64 = z.string().min(1);
const Nonnegative = z.number().int().nonnegative();
const Phase = z.enum(["baseline", "subject"]);
const RateMetricName = z.enum(["schema_reliability", "copyedit_preservation", "claim_grounding", "required_attribution", "event_coverage", "announcement_relevance"]);
const DenominatorUnit = z.enum(["terminal_provider_success_invocation", "parse_success_copyedit_output", "human_annotated_factual_claim", "human_annotated_required_attribution_claim", "source_event_output_pair", "parsed_announcement"]);
const DistributionMetricName = z.enum(["input_tokens", "output_tokens", "total_tokens", "application_latency_ms", "provider_time_to_first_token_ms", "provider_total_time_ms"]);
const CriterionName = z.enum(["coherence", "usefulness", "newsworthiness", "voice"]);
const CountName = z.enum(["declared_trial_count", "step_reached_trial_count", "step_not_reached_trial_count", "invocation_attempt_count", "initial_attempt_count", "retry_attempt_count", "transport_failed_attempt_count", "transport_succeeded_attempt_count", "parse_succeeded_invocation_count", "parse_rejected_invocation_count", "annotated_output_count", "reviewed_output_count"]);

export const EvaluationLongitudinalDeclarationV1Schema = z.strictObject({
	version: z.literal(1), id: EvaluationIdSchema,
	scorecards: z.array(z.strictObject({
		ordinal: z.number().int().positive(), phase: Phase, path: z.string().min(1).refine((value) => value === value.trim(), "Path must be trimmed"),
		scorecard_id: EvaluationIdSchema, scorecard_sha256: Hash,
	})).min(1),
}).superRefine((declaration, context) => {
	const firstSubject = declaration.scorecards.findIndex(({ phase }) => phase === "subject");
	if (firstSubject <= 0 || declaration.scorecards.slice(firstSubject).some(({ phase }) => phase !== "subject")) context.addIssue({ code: "custom", path: ["scorecards"], message: "scorecards must contain a baseline partition followed by a subject partition" });
	if (declaration.scorecards.some(({ ordinal }, index) => ordinal !== index + 1)) context.addIssue({ code: "custom", path: ["scorecards"], message: "scorecard ordinals must be exactly contiguous from one" });
	for (const [field, values] of [
		["scorecard_id", declaration.scorecards.map(({ scorecard_id }) => scorecard_id)],
		["path", declaration.scorecards.map(({ path }) => path)],
		["scorecard_sha256", declaration.scorecards.map(({ scorecard_sha256 }) => scorecard_sha256)],
	] as const) if (new Set(values).size !== values.length) context.addIssue({ code: "custom", path: ["scorecards"], message: `scorecard ${field} values must be unique` });
	for (const [index, descriptor] of declaration.scorecards.entries()) {
		const segments = descriptor.path.split(/[\\/]/u);
		if (isAbsolute(descriptor.path) || descriptor.path.includes("\\") || normalize(descriptor.path) !== descriptor.path || descriptor.path === "." || segments.some((segment) => segment === "." || segment === "..")) context.addIssue({ code: "custom", path: ["scorecards", index, "path"], message: "scorecard path must be a normalized contained relative path" });
	}
});

const UnknownStableContextSchema = z.strictObject({ state: z.literal("unknown"), reason: z.literal("no_captured_invocation") });
const StableProjectionSchema = z.strictObject({
	scorecard_version: z.literal(1), corpus_manifest_id: EvaluationIdSchema, corpus_manifest_sha256: Hash,
	ordered_fixture_prepared_identities: z.array(z.strictObject({ fixture_id: z.string(), fixture_sha256: Hash, prepared_evidence_identity_sha256: Hash })),
	code_provenance: z.strictObject({ repository: z.literal("bc-news"), commit_sha: z.string().regex(/^[0-9a-f]{40}$/u), dirty: z.literal(false) }),
	ordered_output_contract_provenance: z.array(z.strictObject({ production_step: V1ProductionModelStepSchema, canonical_schema: z.unknown(), schema_sha256: Hash })),
	adapter: V6ModelAdapterConfigSchema, declared_transport_retry_limit: z.number().int().min(0).max(3),
	ordered_requests: z.array(z.strictObject({ observation_ordinal: z.number().int().positive(), request_sha256: Hash })),
	normalized_execution_context: ModelExecutionContextSchema,
});
const IdentifiedStableContextSchema = z.strictObject({ state: z.literal("identified"), identity: EvaluationIdSchema, projection: StableProjectionSchema });
export const StableLongitudinalContextV1Schema = z.discriminatedUnion("state", [IdentifiedStableContextSchema, UnknownStableContextSchema]);
export type StableLongitudinalContextV1 = z.infer<typeof StableLongitudinalContextV1Schema>;

const ProvenanceSchema = z.strictObject({
	annotation: z.strictObject({ protocol_id: z.literal("bc-news-output-annotation"), protocol_version: z.literal(1), annotator_id: z.string().min(1), annotated_at: EvaluationTimestampSchema }),
	review: z.strictObject({ rubric_id: z.literal("bc-news-editorial-qualitative"), rubric_version: z.literal(1), reviewer_id: z.string().min(1), reviewed_at: EvaluationTimestampSchema }),
});
const SourceIdentitySchema = z.strictObject({ ordinal: z.number().int().positive(), phase: Phase, scorecard_id: EvaluationIdSchema, scorecard_sha256: Hash, created_at: EvaluationTimestampSchema, provenance: ProvenanceSchema });
const ContextSourceSchema = z.strictObject({ ...SourceIdentitySchema.shape, context: StableLongitudinalContextV1Schema });
const DifferenceValueSchema = z.discriminatedUnion("state", [z.strictObject({ state: z.literal("present"), value: z.unknown() }), z.strictObject({ state: z.literal("missing") })]);
const ContextDifferenceSchema = z.strictObject({ reference_scorecard_id: EvaluationIdSchema, compared_scorecard_id: EvaluationIdSchema, compared_ordinal: z.number().int().positive(), path: z.string(), reference_value: DifferenceValueSchema, compared_value: DifferenceValueSchema });

const CountsSchema = z.strictObject(Object.fromEntries(CountName.options.map((key) => [key, Nonnegative])));
const CountHistorySchema = z.strictObject({ metric: CountName, unit: z.literal("count"), sources: z.array(z.strictObject({ ...SourceIdentitySchema.shape, value: Nonnegative })), baseline_total: Nonnegative, subject_total: Nonnegative });
const SourceRateMeasurementSchema = z.discriminatedUnion("state", [
	z.strictObject({ state: z.literal("measured"), metric: RateMetricName, unit: z.literal("ratio"), denominator_unit: DenominatorUnit, scorecard_context: z.unknown(), numerator: Nonnegative, denominator: z.number().int().positive(), sample_count: z.number().int().positive(), value: z.number().finite().min(0).max(1), interval: z.strictObject({ confidence: z.literal(0.95), method: z.literal("wilson_score"), lower: z.number().finite().min(0).max(1), upper: z.number().finite().min(0).max(1) }) }),
	z.strictObject({ state: z.literal("not_applicable"), metric: RateMetricName, unit: z.literal("ratio"), denominator_unit: DenominatorUnit, scorecard_context: z.unknown(), reason: z.enum(["role_not_applicable", "zero_denominator"]), numerator: z.literal(0), denominator: z.literal(0), sample_count: z.literal(0), interval: z.strictObject({ state: z.literal("not_applicable") }) }),
]);
const RateObservationSchema = z.strictObject({ ...SourceIdentitySchema.shape, measurement: SourceRateMeasurementSchema });
const RatePoolSchema = z.discriminatedUnion("state", [
	z.strictObject({ state: z.literal("measured"), numerator: Nonnegative, denominator: z.number().int().positive(), sample_count: z.number().int().positive(), value: z.number().finite().min(0).max(1), interval: z.strictObject({ confidence: z.literal(0.95), method: z.literal("wilson_score"), lower: z.number().finite().min(0).max(1), upper: z.number().finite().min(0).max(1) }) }),
	z.strictObject({ state: z.literal("not_applicable"), numerator: Nonnegative, denominator: z.literal(0), sample_count: z.literal(0), reason: z.literal("zero_pooled_denominator") }),
]);
const RatePhaseSchema = z.strictObject({ source_pack_count: z.number().int().positive(), observations: z.array(RateObservationSchema).min(1), pool: RatePoolSchema });
const RateEligibilitySchema = z.discriminatedUnion("state", [z.strictObject({ state: z.literal("eligible") }), z.strictObject({ state: z.literal("ineligible"), reasons: z.array(z.enum(["source_not_measured", "zero_denominator", "metric_contract_mismatch"])).min(1) })]);
const RateHistorySchema = z.strictObject({ metric: RateMetricName, unit: z.literal("ratio"), denominator_unit: DenominatorUnit, baseline: RatePhaseSchema, subject: RatePhaseSchema, eligibility: RateEligibilitySchema, signal_observed: z.boolean(), method: z.literal("strict_wilson_interval_disjointness") });

const DistributionSampleSchema = z.strictObject({ source_scorecard_id: EvaluationIdSchema, source_scorecard_sha256: Hash, run_id: EvaluationIdSchema, trial_id: EvaluationIdSchema, invocation_id: EvaluationIdSchema, value: z.number().finite().nonnegative() });
const DistributionSummarySchema = z.discriminatedUnion("state", [z.strictObject({ state: z.literal("measured"), min: z.number().finite().nonnegative(), median: z.number().finite().nonnegative(), mean: z.number().finite().nonnegative(), max: z.number().finite().nonnegative() }), z.strictObject({ state: z.literal("unavailable") })]);
const DistributionSourceSchema = z.strictObject({ ...SourceIdentitySchema.shape, sample_count: Nonnegative, observed_sample_count: Nonnegative, unavailable_sample_count: Nonnegative });
const DistributionPhaseSchema = z.strictObject({ source_pack_count: z.number().int().positive(), sources: z.array(DistributionSourceSchema).min(1), sample_count: Nonnegative, observed_sample_count: Nonnegative, unavailable_sample_count: Nonnegative, samples: z.array(DistributionSampleSchema), summary: DistributionSummarySchema });
const DistributionEligibilitySchema = z.discriminatedUnion("state", [z.strictObject({ state: z.literal("eligible") }), z.strictObject({ state: z.literal("ineligible"), reasons: z.array(z.enum(["metric_contract_mismatch", "source_without_observation", "baseline_below_minimum_observations", "subject_below_minimum_observations"])).min(1) })]);
const DistributionHistorySchema = z.strictObject({ metric: DistributionMetricName, unit: z.enum(["tokens", "milliseconds"]), baseline: DistributionPhaseSchema, subject: DistributionPhaseSchema, eligibility: DistributionEligibilitySchema, signal_observed: z.boolean(), method: z.literal("strict_observed_range_disjointness") });

const QualitativeHistorySchema = z.strictObject({ criterion: CriterionName, unit: z.literal("review_assessment"), sample_unit: z.literal("human_reviewed_output"), baseline: z.array(z.strictObject({ ...SourceIdentitySchema.shape, sample_count: Nonnegative, counts: z.strictObject({ meets: Nonnegative, partly_meets: Nonnegative, does_not_meet: Nonnegative, uncertain: Nonnegative }), evidence: z.array(z.unknown()) })), subject: z.array(z.strictObject({ ...SourceIdentitySchema.shape, sample_count: Nonnegative, counts: z.strictObject({ meets: Nonnegative, partly_meets: Nonnegative, does_not_meet: Nonnegative, uncertain: Nonnegative }), evidence: z.array(z.unknown()) })) });
const SignalWitnessSchema = z.discriminatedUnion("kind", [
	z.strictObject({ kind: z.literal("rate"), metric: RateMetricName, method: z.literal("strict_wilson_interval_disjointness"), baseline_interval: z.strictObject({ lower: z.number(), upper: z.number() }), subject_interval: z.strictObject({ lower: z.number(), upper: z.number() }), observed: z.boolean() }),
	z.strictObject({ kind: z.literal("distribution"), metric: DistributionMetricName, method: z.literal("strict_observed_range_disjointness"), baseline_range: z.strictObject({ min: z.number(), max: z.number() }), subject_range: z.strictObject({ min: z.number(), max: z.number() }), observed: z.boolean() }),
]);
const ClassificationSchema = z.discriminatedUnion("state", [
	z.strictObject({ state: z.literal("context_changed"), context_identities: z.array(EvaluationIdSchema).min(2), differences: z.array(ContextDifferenceSchema).min(1) }),
	z.strictObject({ state: z.literal("insufficient_evidence"), reasons: z.array(z.enum(["unidentified_context", "baseline_below_minimum", "subject_below_minimum", "no_eligible_quantitative_measurement"])).min(1) }),
	z.strictObject({ state: z.literal("potential_drift"), signal_witnesses: z.array(SignalWitnessSchema).min(1) }),
	z.strictObject({ state: z.literal("within_baseline"), signal_witnesses: z.array(SignalWitnessSchema).min(1) }),
]);

const RoleHistoryBaseSchema = z.strictObject({
	production_step: V1ProductionModelStepSchema, baseline_pack_count: z.number().int().positive(), subject_pack_count: z.number().int().positive(),
	sources: z.array(ContextSourceSchema).min(2), stable_contexts: z.array(StableLongitudinalContextV1Schema).min(2), context_differences: z.array(ContextDifferenceSchema),
	phase_count_summaries: z.strictObject({ baseline: CountsSchema, subject: CountsSchema }), count_histories: z.array(CountHistorySchema).length(12),
	rate_histories: z.array(RateHistorySchema).length(6), distribution_histories: z.array(DistributionHistorySchema).length(6), qualitative_histories: z.array(QualitativeHistorySchema).length(4),
	eligible_signal_witnesses: z.array(SignalWitnessSchema), classification: ClassificationSchema,
});
export const EvaluationLongitudinalRoleHistoryV1Schema = RoleHistoryBaseSchema;
export type EvaluationLongitudinalRoleHistoryV1 = z.infer<typeof EvaluationLongitudinalRoleHistoryV1Schema>;

const PolicySchema = z.strictObject({ minimum_baseline_scorecards: z.literal(3), minimum_subject_scorecards: z.literal(2), rate_interval: z.strictObject({ confidence: z.literal(0.95), method: z.literal("wilson_score"), z: z.literal(1.959963984540054) }), rate_signal_method: z.literal("strict_wilson_interval_disjointness"), distribution_signal_method: z.literal("strict_observed_range_disjointness"), classifier_precedence: z.tuple([z.literal("context_changed"), z.literal("insufficient_evidence"), z.literal("potential_drift"), z.literal("within_baseline")]) });
const ScorecardHashSchema = z.strictObject({ ordinal: z.number().int().positive(), phase: Phase, scorecard_id: EvaluationIdSchema, scorecard_sha256: Hash, created_at: EvaluationTimestampSchema });
const SourcePayloadsSchema = z.strictObject({ declaration_base64: Base64, scorecards: z.array(z.strictObject({ ordinal: z.number().int().positive(), phase: Phase, scorecard_id: EvaluationIdSchema, bytes_base64: Base64 })).min(2) });

export const EvaluationLongitudinalScorecardArtifactV1Schema = z.strictObject({
	version: z.literal(1), id: EvaluationIdSchema, created_at: EvaluationTimestampSchema, policy: PolicySchema,
	source_payloads: SourcePayloadsSchema, declaration_sha256: Hash, scorecard_hashes: z.array(ScorecardHashSchema).min(2),
	roles: z.tuple([
		RoleHistoryBaseSchema.extend({ production_step: z.literal("main_story_write") }),
		RoleHistoryBaseSchema.extend({ production_step: z.literal("main_story_copyedit") }),
		RoleHistoryBaseSchema.extend({ production_step: z.literal("announcements_write") }),
		RoleHistoryBaseSchema.extend({ production_step: z.literal("announcements_copyedit") }),
	]),
});

export type EvaluationLongitudinalDeclarationV1 = z.infer<typeof EvaluationLongitudinalDeclarationV1Schema>;
export type EvaluationLongitudinalScorecardArtifactV1 = z.infer<typeof EvaluationLongitudinalScorecardArtifactV1Schema>;
