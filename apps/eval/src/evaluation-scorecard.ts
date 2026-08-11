import { z } from "zod";
import { ModelExecutionContextSchema } from "@bc-news/generation-core";
import { EvaluationIdSchema, EvaluationTimestampSchema } from "./evaluation-artifact-schemas";
import { V1ProductionModelStepSchema, V1Sha256HashSchema } from "./evaluation-artifact-v1-contracts";
import { V6EvalConfigSchema, V6ModelAdapterConfigSchema } from "./evaluation-artifact-v6";
import { RepositoryPathSchema, RepositorySourceReferenceSchema } from "./evaluation-repository-reference";

export const EVALUATION_SCORECARD_ERROR_CODES = [
	"invalid_declaration_json", "declaration_rejected", "source_unreadable", "source_hash_mismatch",
	"benchmark_artifact_malformed", "benchmark_artifact_invalid", "benchmark_filename_mismatch",
	"unsupported_benchmark_version", "benchmark_not_complete", "benchmark_not_retained", "evidence_set_mismatch",
	"corpus_binding_mismatch", "configuration_mismatch", "repetition_mismatch", "provenance_mismatch",
	"execution_context_mismatch", "annotation_bundle_rejected", "review_bundle_rejected",
	"output_identity_mismatch", "annotation_completeness_mismatch", "review_completeness_mismatch",
	"span_mismatch", "reference_mismatch", "relation_mismatch", "denominator_mismatch", "chronology_mismatch",
	"artifact_tampered", "invalid_scorecard_id", "scorecard_not_found", "scorecard_malformed",
	"scorecard_invalid", "scorecard_filename_mismatch", "scorecard_create_rejected",
] as const;
export type EvaluationScorecardErrorCode = typeof EVALUATION_SCORECARD_ERROR_CODES[number];

export class EvaluationScorecardError extends Error {
	readonly code: EvaluationScorecardErrorCode;
	readonly path: string;
	constructor(code: EvaluationScorecardErrorCode, path: string, message: string, options?: ErrorOptions) {
		super(message, options); this.name = "EvaluationScorecardError"; this.code = code; this.path = path;
	}
}

const Trimmed = z.string().min(1).refine((value) => value === value.trim(), "String must be trimmed");
const Kebab = Trimmed.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const Hash = V1Sha256HashSchema;
const Base64 = z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u);
const Nonnegative = z.number().int().nonnegative();

export const EvaluationScorecardDeclarationV1Schema = z.strictObject({
	version: z.literal(1), id: EvaluationIdSchema,
	corpus: z.strictObject({ manifest_path: Trimmed, manifest_sha256: Hash }),
	benchmark_results_directory: Trimmed, configuration_identity: EvaluationIdSchema,
	runs: z.array(z.strictObject({ ordinal: z.number().int().positive(), corpus_fixture_id: Kebab, benchmark_run_id: EvaluationIdSchema, benchmark_run_sha256: Hash })).min(1),
	annotations: z.strictObject({ path: Trimmed, sha256: Hash }),
	qualitative_reviews: z.strictObject({ path: Trimmed, sha256: Hash }),
});

export const OutputIdentityV1Schema = z.strictObject({
	benchmark_run_id: EvaluationIdSchema, benchmark_run_version: z.literal(7), benchmark_run_sha256: Hash,
	code_commit_sha: z.string().regex(/^[0-9a-f]{40}$/u), fixture_sha256: Hash, prepared_evidence_identity_sha256: Hash,
	corpus_manifest_id: EvaluationIdSchema, corpus_manifest_sha256: Hash, corpus_fixture_id: Kebab, reference_sha256: Hash,
	config_identity: EvaluationIdSchema, trial_id: EvaluationIdSchema, repetition: z.number().int().positive(),
	invocation_id: EvaluationIdSchema, production_step: V1ProductionModelStepSchema, invocation_ordinal: z.number().int().positive(),
	request_sha256: Hash, completion_text_sha256: Hash, parsed_output_sha256: Hash, runtime_evidence_sha256: Hash,
});
export type OutputIdentityV1 = z.infer<typeof OutputIdentityV1Schema>;

export const OutputSpanSchema = z.strictObject({
	json_pointer: z.string(), start_utf16: Nonnegative, end_utf16: z.number().int().positive(), excerpt: Trimmed,
});
const ReferenceRelationSchema = z.strictObject({
	reference_id: z.string().regex(/^(?:claim|event|ambiguity|entity|number|noteworthy):[a-z0-9]+(?:-[a-z0-9]+)*$/u),
	relation: z.enum(["supports", "supports_status_qualified", "opposes", "unresolved"]),
});
const UncertaintySchema = z.enum(["low", "medium", "high"]);

export const OutputAnnotationSchema = z.strictObject({
	annotation_id: EvaluationIdSchema, output: OutputIdentityV1Schema, factual_claim_inventory_complete: z.literal(true),
	factual_claims: z.array(z.strictObject({
		id: Kebab, proposition: Trimmed, atomic_proposition: z.literal(true), spans: z.array(OutputSpanSchema).min(1),
		references: z.array(ReferenceRelationSchema), grounding: z.enum(["grounded", "not_grounded", "indeterminate"]),
		attribution_requirement: z.enum(["required", "not_required", "indeterminate"]),
		attribution: z.enum(["present", "absent", "indeterminate", "not_applicable"]), rationale: Trimmed, uncertainty: UncertaintySchema,
	})),
	event_coverage: z.array(z.strictObject({
		event_id: Kebab, assessment: z.enum(["covered", "not_covered", "indeterminate"]),
		spans: z.array(OutputSpanSchema), rationale: Trimmed, uncertainty: UncertaintySchema,
	})),
	announcement_relevance: z.discriminatedUnion("state", [
		z.strictObject({ state: z.literal("not_applicable") }),
		z.strictObject({ state: z.literal("assessed"), announcements: z.array(z.strictObject({
			announcement_index: Nonnegative, assessment: z.enum(["relevant", "not_relevant", "indeterminate"]),
			noteworthy_reference_ids: z.array(z.string().regex(/^noteworthy:[a-z0-9]+(?:-[a-z0-9]+)*$/u)), rationale: Trimmed, uncertainty: UncertaintySchema,
		})) }),
	]),
});

export const AnnotationBundleV1Schema = z.strictObject({
	version: z.literal(1), protocol: z.strictObject({ id: z.literal("bc-news-output-annotation"), version: z.literal(1) }),
	annotator: z.strictObject({ id: Trimmed, kind: z.literal("human") }), annotated_at: EvaluationTimestampSchema,
	outputs: z.array(OutputAnnotationSchema),
});

const CriterionSchema = z.enum(["coherence", "usefulness", "newsworthiness", "voice"]);
const AssessmentSchema = z.enum(["meets", "partly_meets", "does_not_meet", "uncertain"]);
const CriterionReviewSchema = z.strictObject({ criterion: CriterionSchema, assessment: AssessmentSchema, rationale: Trimmed, uncertainty: UncertaintySchema });
export const QualitativeReviewBundleV1Schema = z.strictObject({
	version: z.literal(1), rubric: z.strictObject({ id: z.literal("bc-news-editorial-qualitative"), version: z.literal(1) }),
	reviewer: z.strictObject({ id: Trimmed, kind: z.literal("human") }), reviewed_at: EvaluationTimestampSchema,
	reviews: z.array(z.strictObject({ review_id: EvaluationIdSchema, output: OutputIdentityV1Schema, criteria: z.tuple([
		CriterionReviewSchema.extend({ criterion: z.literal("coherence") }), CriterionReviewSchema.extend({ criterion: z.literal("usefulness") }),
		CriterionReviewSchema.extend({ criterion: z.literal("newsworthiness") }), CriterionReviewSchema.extend({ criterion: z.literal("voice") }),
	]) })),
});

const ContextSchema = z.discriminatedUnion("state", [
	z.strictObject({ state: z.literal("identified"), identity: EvaluationIdSchema, projection: z.strictObject({
		corpus_manifest_id: EvaluationIdSchema, corpus_manifest_sha256: Hash,
		fixture_prepared_identities: z.array(z.strictObject({ fixture_id: Kebab, fixture_sha256: Hash, prepared_evidence_identity_sha256: Hash })),
		code_provenance: z.strictObject({ repository: z.literal("bc-news"), commit_sha: z.string().regex(/^[0-9a-f]{40}$/u), dirty: z.literal(false) }),
		output_contract_provenance: z.array(z.strictObject({ production_step: V1ProductionModelStepSchema, canonical_schema: z.json(), schema_sha256: Hash })),
		adapter: V6ModelAdapterConfigSchema, request_hashes: z.array(z.strictObject({ run_id: EvaluationIdSchema, trial_id: EvaluationIdSchema, request_sha256: Hash })),
		execution_context: ModelExecutionContextSchema,
	}) }),
	z.strictObject({ state: z.literal("unknown"), reason: z.literal("no_captured_invocation") }),
]);
export type ScorecardContextV1 = z.infer<typeof ContextSchema>;

const RateMetricName = z.enum(["schema_reliability", "copyedit_preservation", "claim_grounding", "required_attribution", "event_coverage", "announcement_relevance"]);
const DenominatorUnit = z.enum(["terminal_provider_success_invocation", "parse_success_copyedit_output", "human_annotated_factual_claim", "human_annotated_required_attribution_claim", "source_event_output_pair", "parsed_announcement"]);
const MeasuredRateSchema = z.strictObject({ state: z.literal("measured"), metric: RateMetricName, unit: z.literal("ratio"), denominator_unit: DenominatorUnit, scorecard_context: ContextSchema, numerator: Nonnegative, denominator: z.number().int().positive(), sample_count: z.number().int().positive(), value: z.number().finite().min(0).max(1), interval: z.strictObject({ confidence: z.literal(0.95), method: z.literal("wilson_score"), lower: z.number().finite().min(0).max(1), upper: z.number().finite().min(0).max(1) }) });
const InapplicableRateSchema = z.strictObject({ state: z.literal("not_applicable"), metric: RateMetricName, unit: z.literal("ratio"), denominator_unit: DenominatorUnit, scorecard_context: ContextSchema, reason: z.enum(["role_not_applicable", "zero_denominator"]), numerator: z.literal(0), denominator: z.literal(0), sample_count: z.literal(0), interval: z.strictObject({ state: z.literal("not_applicable") }) });
export const RateMetricSchema = z.discriminatedUnion("state", [MeasuredRateSchema, InapplicableRateSchema]);

const DistributionMetric = z.enum(["input_tokens", "output_tokens", "total_tokens", "application_latency_ms", "provider_time_to_first_token_ms", "provider_total_time_ms"]);
const DistributionSchema = z.strictObject({
	metric: DistributionMetric, unit: z.enum(["tokens", "milliseconds"]), scorecard_context: ContextSchema,
	sample_count: Nonnegative, observed_sample_count: Nonnegative, unavailable_sample_count: Nonnegative,
	samples: z.array(z.strictObject({ run_id: EvaluationIdSchema, trial_id: EvaluationIdSchema, invocation_id: EvaluationIdSchema, value: z.number().finite().nonnegative() })),
	summary: z.union([z.strictObject({ state: z.literal("measured"), min: z.number().finite().nonnegative(), median: z.number().finite().nonnegative(), mean: z.number().finite().nonnegative(), max: z.number().finite().nonnegative() }), z.strictObject({ state: z.literal("unavailable") })]),
});
const CountsSchema = z.strictObject(Object.fromEntries(["declared_trial_count", "step_reached_trial_count", "step_not_reached_trial_count", "invocation_attempt_count", "initial_attempt_count", "retry_attempt_count", "transport_failed_attempt_count", "transport_succeeded_attempt_count", "parse_succeeded_invocation_count", "parse_rejected_invocation_count", "annotated_output_count", "reviewed_output_count"].map((key) => [key, Nonnegative])));
const CriterionSummarySchema = z.strictObject({
	criterion: CriterionSchema, unit: z.literal("review_assessment"), sample_unit: z.literal("human_reviewed_output"), scorecard_context: ContextSchema,
	sample_count: Nonnegative, counts: z.strictObject({ meets: Nonnegative, partly_meets: Nonnegative, does_not_meet: Nonnegative, uncertain: Nonnegative }),
	evidence: z.array(z.strictObject({ review_id: EvaluationIdSchema, output: OutputIdentityV1Schema, assessment: AssessmentSchema, rationale: Trimmed, uncertainty: UncertaintySchema })),
});
const ScorecardSchema = z.strictObject({
	production_step: V1ProductionModelStepSchema, adapter: V6ModelAdapterConfigSchema, scorecard_context: ContextSchema,
	sample_counts: CountsSchema, rates: z.array(RateMetricSchema).length(6), distributions: z.array(DistributionSchema).length(6), qualitative: z.array(CriterionSummarySchema).length(4),
});

const SourcePayloadsSchema = z.strictObject({
	declaration_base64: Base64, corpus_manifest_base64: Base64,
	corpus_entries: z.array(z.strictObject({ fixture_id: Kebab, evidence_base64: Base64, reference_base64: Base64 })),
	benchmark_runs: z.array(z.strictObject({ run_id: EvaluationIdSchema, bytes_base64: Base64 })),
	annotation_bundle_base64: Base64, qualitative_review_bundle_base64: Base64,
});
export const EvaluationScorecardArtifactV1Schema = z.strictObject({
	version: z.literal(1), id: EvaluationIdSchema, created_at: EvaluationTimestampSchema, source_payloads: SourcePayloadsSchema,
	declaration_sha256: Hash, corpus: z.strictObject({ id: EvaluationIdSchema, manifest_sha256: Hash, fixture_count: z.number().int().positive() }),
	configuration: z.strictObject({ identity: EvaluationIdSchema, exact_config: V6EvalConfigSchema }), repetition_count: z.number().int().positive(),
	benchmark_run_hashes: z.array(z.strictObject({ ordinal: z.number().int().positive(), corpus_fixture_id: Kebab, benchmark_run_id: EvaluationIdSchema, benchmark_run_sha256: Hash, fixture_sha256: Hash, prepared_evidence_identity_sha256: Hash, code_commit_sha: z.string().regex(/^[0-9a-f]{40}$/u), output_contract_sha256s: z.array(Hash).length(4) })),
	scorecards: z.array(ScorecardSchema).length(4),
});

export type EvaluationScorecardDeclarationV1 = z.infer<typeof EvaluationScorecardDeclarationV1Schema>;
export type AnnotationBundleV1 = z.infer<typeof AnnotationBundleV1Schema>;
export type QualitativeReviewBundleV1 = z.infer<typeof QualitativeReviewBundleV1Schema>;
export type EvaluationScorecardArtifactV1 = z.infer<typeof EvaluationScorecardArtifactV1Schema>;
export type EvaluationRoleScorecardV1 = EvaluationScorecardArtifactV1["scorecards"][number];

export const EvaluationScorecardDeclarationSchema = z.strictObject({
	version: z.literal(2),
	id: EvaluationIdSchema,
	corpus: z.strictObject({ manifest_path: RepositoryPathSchema }),
	configuration_identity: EvaluationIdSchema,
	runs: z.array(z.strictObject({
		ordinal: z.number().int().positive(),
		corpus_fixture_id: Kebab,
		benchmark_run_id: EvaluationIdSchema,
		path: RepositoryPathSchema,
	})).min(1),
	annotations: z.strictObject({ path: RepositoryPathSchema, bundle_id: EvaluationIdSchema }),
	qualitative_reviews: z.strictObject({ path: RepositoryPathSchema, bundle_id: EvaluationIdSchema }),
});

export const OutputIdentitySchema = z.strictObject({
	benchmark_run_id: EvaluationIdSchema,
	benchmark_run_version: z.literal(7),
	code_commit_sha: z.string().regex(/^[0-9a-f]{40}$/u),
	prepared_evidence_identity_sha256: Hash,
	corpus_manifest_id: EvaluationIdSchema,
	corpus_fixture_id: Kebab,
	config_identity: EvaluationIdSchema,
	trial_id: EvaluationIdSchema,
	repetition: z.number().int().positive(),
	invocation_id: EvaluationIdSchema,
	production_step: V1ProductionModelStepSchema,
	invocation_ordinal: z.number().int().positive(),
	request_sha256: Hash,
	completion_text_sha256: Hash,
	parsed_output_sha256: Hash,
	runtime_evidence_sha256: Hash,
});
export type OutputIdentity = z.infer<typeof OutputIdentitySchema>;

const OutputAnnotationV2Schema = OutputAnnotationSchema.extend({ output: OutputIdentitySchema }).strict();
export const AnnotationBundleSchema = z.strictObject({
	version: z.literal(2),
	id: EvaluationIdSchema,
	protocol: z.strictObject({ id: z.literal("bc-news-output-annotation"), version: z.literal(2) }),
	annotator: z.strictObject({ id: Trimmed, kind: z.literal("codex") }),
	annotated_at: EvaluationTimestampSchema,
	outputs: z.array(OutputAnnotationV2Schema),
});

const QualitativeReviewV2Schema = QualitativeReviewBundleV1Schema.shape.reviews.element.extend({ output: OutputIdentitySchema }).strict();
export const QualitativeReviewBundleSchema = z.strictObject({
	version: z.literal(2),
	id: EvaluationIdSchema,
	rubric: z.strictObject({ id: z.literal("bc-news-editorial-qualitative"), version: z.literal(2) }),
	reviewer: z.strictObject({ id: Trimmed, kind: z.literal("codex") }),
	reviewed_at: EvaluationTimestampSchema,
	reviews: z.array(QualitativeReviewV2Schema),
});

const ContextV2Schema = z.discriminatedUnion("state", [
	z.strictObject({ state: z.literal("identified"), identity: EvaluationIdSchema, projection: z.strictObject({
		corpus_manifest_id: EvaluationIdSchema,
		corpus_source_reference: RepositorySourceReferenceSchema,
		fixture_prepared_identities: z.array(z.strictObject({ fixture_id: Kebab, prepared_evidence_identity_sha256: Hash })),
		code_provenance: z.strictObject({ repository: z.literal("bc-news"), commit_sha: z.string().regex(/^[0-9a-f]{40}$/u), dirty: z.literal(false) }),
		output_contract_provenance: z.array(z.strictObject({ production_step: V1ProductionModelStepSchema, canonical_schema: z.json(), schema_sha256: Hash })),
		adapter: V6ModelAdapterConfigSchema,
		declared_transport_retry_limit: Nonnegative,
		request_hashes: z.array(z.strictObject({ run_id: EvaluationIdSchema, trial_id: EvaluationIdSchema, request_sha256: Hash })),
		execution_context: ModelExecutionContextSchema,
	}) }),
	z.strictObject({ state: z.literal("unknown"), reason: z.literal("no_captured_invocation") }),
]);
export type ScorecardContext = z.infer<typeof ContextV2Schema>;

const DenominatorUnitV2 = z.enum(["terminal_provider_success_invocation", "parse_success_copyedit_output", "codex_annotated_factual_claim", "codex_annotated_required_attribution_claim", "source_event_output_pair", "parsed_announcement"]);
const RateMetricV2Schema = z.discriminatedUnion("state", [
	z.strictObject({ state: z.literal("measured"), metric: RateMetricName, unit: z.literal("ratio"), denominator_unit: DenominatorUnitV2, scorecard_context: ContextV2Schema, numerator: Nonnegative, denominator: z.number().int().positive(), sample_count: z.number().int().positive(), value: z.number().finite().min(0).max(1), interval: z.strictObject({ confidence: z.literal(0.95), method: z.literal("wilson_score"), lower: z.number().finite().min(0).max(1), upper: z.number().finite().min(0).max(1) }) }),
	z.strictObject({ state: z.literal("not_applicable"), metric: RateMetricName, unit: z.literal("ratio"), denominator_unit: DenominatorUnitV2, scorecard_context: ContextV2Schema, reason: z.enum(["role_not_applicable", "zero_denominator"]), numerator: z.literal(0), denominator: z.literal(0), sample_count: z.literal(0), interval: z.strictObject({ state: z.literal("not_applicable") }) }),
]);
const DistributionV2Schema = DistributionSchema.extend({ scorecard_context: ContextV2Schema }).strict();
const CriterionSummaryV2Schema = z.strictObject({
	criterion: CriterionSchema,
	unit: z.literal("review_assessment"),
	sample_unit: z.literal("codex_reviewed_output"),
	scorecard_context: ContextV2Schema,
	sample_count: Nonnegative,
	counts: z.strictObject({ meets: Nonnegative, partly_meets: Nonnegative, does_not_meet: Nonnegative, uncertain: Nonnegative }),
	evidence: z.array(z.strictObject({ review_id: EvaluationIdSchema, output: OutputIdentitySchema, assessment: AssessmentSchema, rationale: Trimmed, uncertainty: UncertaintySchema })),
});
const ScorecardV2Schema = z.strictObject({
	production_step: V1ProductionModelStepSchema,
	adapter: V6ModelAdapterConfigSchema,
	scorecard_context: ContextV2Schema,
	sample_counts: CountsSchema,
	rates: z.array(RateMetricV2Schema).length(6),
	distributions: z.array(DistributionV2Schema).length(6),
	qualitative: z.array(CriterionSummaryV2Schema).length(4),
});

export const EvaluationScorecardArtifactSchema = z.strictObject({
	version: z.literal(2),
	id: EvaluationIdSchema,
	created_at: EvaluationTimestampSchema,
	source_reference: RepositorySourceReferenceSchema,
	corpus: z.strictObject({ id: EvaluationIdSchema, fixture_count: z.number().int().positive() }),
	configuration: z.strictObject({ identity: EvaluationIdSchema, exact_config: V6EvalConfigSchema }),
	repetition_count: z.number().int().positive(),
	sources: z.strictObject({
		corpus_manifest_path: Trimmed,
		benchmark_runs: z.array(z.strictObject({ ordinal: z.number().int().positive(), corpus_fixture_id: Kebab, benchmark_run_id: EvaluationIdSchema, path: Trimmed, code_commit_sha: z.string().regex(/^[0-9a-f]{40}$/u), prepared_evidence_identity_sha256: Hash, output_contract_sha256s: z.array(Hash).length(4), transport_retry_limit: Nonnegative })),
		annotations: z.strictObject({ path: Trimmed, bundle_id: EvaluationIdSchema, protocol_id: Trimmed, annotator_id: Trimmed, annotator_kind: z.literal("codex"), annotated_at: EvaluationTimestampSchema }),
		qualitative_reviews: z.strictObject({ path: Trimmed, bundle_id: EvaluationIdSchema, rubric_id: Trimmed, reviewer_id: Trimmed, reviewer_kind: z.literal("codex"), reviewed_at: EvaluationTimestampSchema }),
	}),
	scorecards: z.array(ScorecardV2Schema).length(4),
});

export type EvaluationScorecardDeclaration = z.infer<typeof EvaluationScorecardDeclarationSchema>;
export type AnnotationBundle = z.infer<typeof AnnotationBundleSchema>;
export type QualitativeReviewBundle = z.infer<typeof QualitativeReviewBundleSchema>;
export type EvaluationScorecardArtifact = z.infer<typeof EvaluationScorecardArtifactSchema>;
export type EvaluationRoleScorecard = EvaluationScorecardArtifact["scorecards"][number];
export type AnyEvaluationScorecardArtifact = EvaluationScorecardArtifactV1 | EvaluationScorecardArtifact;
