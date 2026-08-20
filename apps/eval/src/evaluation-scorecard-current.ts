import { z } from "zod";
import { ModelExecutionContextSchema } from "@bc-news/generation-core";
import { EvalConfigSchema } from "./config";
import { CurrentProductionModelStepSchema } from "./current-production-steps";
import { EvaluationIdSchema, EvaluationTimestampSchema } from "./evaluation-artifact-schemas";
import { V8ModelAdapterConfigSchema } from "./evaluation-artifact-v8";
import { EvaluationLocalSourceReferenceSchema } from "./evaluation-local-source-reference";
import { OutputSpanSchema } from "./evaluation-scorecard-v2";
const Trimmed = z.string().min(1).refine((value) => value === value.trim(), "String must be trimmed");
const Kebab = Trimmed.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const Hash = z.string().regex(/^[0-9a-f]{64}$/u);
const Nonnegative = z.number().int().nonnegative();
const CriterionSchema = z.enum(["coherence", "usefulness", "newsworthiness", "voice"]);
const AssessmentSchema = z.enum(["meets", "partly_meets", "does_not_meet", "uncertain"]);
const UncertaintySchema = z.enum(["low", "medium", "high"]);
const RateMetricName = z.enum([
	"schema_reliability",
	"claim_grounding",
	"required_attribution",
	"event_coverage",
	"announcement_relevance"]);
const DenominatorUnit = z.enum([
	"terminal_provider_success_invocation",
	"codex_annotated_factual_claim",
	"codex_annotated_required_attribution_claim",
	"source_event_output_pair",
	"parsed_announcement"]);
const CountsSchema = z.strictObject(Object.fromEntries([
	"declared_trial_count",
	"step_reached_trial_count",
	"step_not_reached_trial_count",
	"invocation_attempt_count",
	"initial_attempt_count",
	"retry_attempt_count",
	"transport_failed_attempt_count",
	"transport_succeeded_attempt_count",
	"parse_succeeded_invocation_count",
	"parse_rejected_invocation_count",
	"annotated_output_count",
	"reviewed_output_count",
].map((key) => [key, Nonnegative])));
export const EvaluationScorecardDeclarationSchema = z.strictObject({
	version: z.literal(4),
	id: EvaluationIdSchema,
	corpus: z.strictObject({ source_reference: EvaluationLocalSourceReferenceSchema }),
	configuration_identity: EvaluationIdSchema,
	runs: z.array(z.strictObject({
		ordinal: z.number().int().positive(),
		corpus_fixture_id: Kebab,
		benchmark_run_id: EvaluationIdSchema,
		source_reference: EvaluationLocalSourceReferenceSchema,
	})).min(1),
	annotations: z.strictObject({
		source_reference: EvaluationLocalSourceReferenceSchema,
		bundle_id: EvaluationIdSchema,
	}),
	qualitative_reviews: z.strictObject({
		source_reference: EvaluationLocalSourceReferenceSchema,
		bundle_id: EvaluationIdSchema,
	}),
});
export const OutputIdentitySchema = z.strictObject({
	benchmark_run_id: EvaluationIdSchema,
	benchmark_run_version: z.literal(9),
	code_commit_sha: z.string().regex(/^[0-9a-f]{40}$/u),
	prepared_evidence_identity_sha256: Hash,
	corpus_manifest_id: EvaluationIdSchema,
	corpus_fixture_id: Kebab,
	config_identity: EvaluationIdSchema,
	trial_id: EvaluationIdSchema,
	repetition: z.number().int().positive(),
	invocation_id: EvaluationIdSchema,
	production_step: CurrentProductionModelStepSchema,
	invocation_ordinal: z.number().int().positive(),
	request_sha256: Hash,
	completion_text_sha256: Hash,
	parsed_output_sha256: Hash,
	runtime_evidence_sha256: Hash,
	gateway_request_sha256: Hash,
});
const OutputAnnotationSchema = z.strictObject({
	annotation_id: EvaluationIdSchema,
	output: OutputIdentitySchema,
	factual_claim_inventory_complete: z.literal(true),
	factual_claims: z.array(z.strictObject({
		id: Kebab,
		proposition: Trimmed,
		atomic_proposition: z.literal(true),
		spans: z.array(OutputSpanSchema).min(1),
		references: z.array(z.strictObject({
			reference_id: z.string().regex(/^(?:claim|event|ambiguity|entity|number|noteworthy):[a-z0-9]+(?:-[a-z0-9]+)*$/u),
			relation: z.enum(["supports", "supports_status_qualified", "opposes", "unresolved"]),
		})),
		grounding: z.enum(["grounded", "not_grounded", "indeterminate"]),
		attribution_requirement: z.enum(["required", "not_required", "indeterminate"]),
		attribution: z.enum(["present", "absent", "indeterminate", "not_applicable"]),
		rationale: Trimmed,
		uncertainty: UncertaintySchema,
	})),
	event_coverage: z.array(z.strictObject({
		event_id: Kebab,
		assessment: z.enum(["covered", "not_covered", "indeterminate"]),
		spans: z.array(OutputSpanSchema),
		rationale: Trimmed,
		uncertainty: UncertaintySchema,
	})),
	announcement_relevance: z.discriminatedUnion("state", [
		z.strictObject({ state: z.literal("not_applicable") }),
		z.strictObject({
			state: z.literal("assessed"),
			announcements: z.array(z.strictObject({
				announcement_index: Nonnegative,
				assessment: z.enum(["relevant", "not_relevant", "indeterminate"]),
				noteworthy_reference_ids: z.array(z.string().regex(/^noteworthy:[a-z0-9]+(?:-[a-z0-9]+)*$/u)),
				rationale: Trimmed,
				uncertainty: UncertaintySchema,
			})),
		}),
	]),
});
export const AnnotationBundleSchema = z.strictObject({
	version: z.literal(3),
	id: EvaluationIdSchema,
	protocol: z.strictObject({
		id: z.literal("bc-news-output-annotation"),
		version: z.literal(3),
	}),
	annotator: z.strictObject({ id: Trimmed, kind: z.literal("codex") }),
	annotated_at: EvaluationTimestampSchema,
	outputs: z.array(OutputAnnotationSchema),
});
const CriterionReviewSchema = z.strictObject({
	criterion: CriterionSchema,
	assessment: AssessmentSchema,
	rationale: Trimmed,
	uncertainty: UncertaintySchema,
});
export const QualitativeReviewBundleSchema = z.strictObject({
	version: z.literal(3),
	id: EvaluationIdSchema,
	rubric: z.strictObject({
		id: z.literal("bc-news-editorial-qualitative"),
		version: z.literal(3),
	}),
	reviewer: z.strictObject({ id: Trimmed, kind: z.literal("codex") }),
	reviewed_at: EvaluationTimestampSchema,
	reviews: z.array(z.strictObject({
		review_id: EvaluationIdSchema,
		output: OutputIdentitySchema,
		criteria: z.tuple([
			CriterionReviewSchema.extend({ criterion: z.literal("coherence") }),
			CriterionReviewSchema.extend({ criterion: z.literal("usefulness") }),
			CriterionReviewSchema.extend({ criterion: z.literal("newsworthiness") }),
			CriterionReviewSchema.extend({ criterion: z.literal("voice") }),
		]),
	})),
});
const ScorecardContextSchema = z.discriminatedUnion("state", [
	z.strictObject({
		state: z.literal("identified"),
		identity: EvaluationIdSchema,
		projection: z.strictObject({
			corpus_manifest_id: EvaluationIdSchema,
			corpus_source_reference: EvaluationLocalSourceReferenceSchema,
			fixture_prepared_identities: z.array(z.strictObject({
				fixture_id: Kebab,
				prepared_evidence_identity_sha256: Hash,
			})),
			code_provenance: z.strictObject({
				repository: z.literal("bc-news"),
				commit_sha: z.string().regex(/^[0-9a-f]{40}$/u),
				dirty: z.literal(false),
			}),
			output_contract_provenance: z.array(z.strictObject({
				production_step: CurrentProductionModelStepSchema,
				canonical_schema: z.json(),
				schema_sha256: Hash,
			})).length(2),
			adapter: V8ModelAdapterConfigSchema,
			declared_transport_retry_limit: Nonnegative,
			request_hashes: z.array(z.strictObject({
				run_id: EvaluationIdSchema,
				trial_id: EvaluationIdSchema,
				request_sha256: Hash,
			})),
			gateway_request_hashes: z.array(z.strictObject({
				run_id: EvaluationIdSchema,
				trial_id: EvaluationIdSchema,
				invocation_id: EvaluationIdSchema,
				gateway_request_sha256: Hash,
			})),
			execution_context: ModelExecutionContextSchema,
		}),
	}),
	z.strictObject({
		state: z.literal("unknown"),
		reason: z.literal("no_captured_invocation"),
	}),
]);
export type ScorecardContext = z.infer<typeof ScorecardContextSchema>;
const RateMetricSchema = z.discriminatedUnion("state", [
	z.strictObject({
		state: z.literal("measured"),
		metric: RateMetricName,
		unit: z.literal("ratio"),
		denominator_unit: DenominatorUnit,
		scorecard_context: ScorecardContextSchema,
		numerator: Nonnegative,
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
		metric: RateMetricName,
		unit: z.literal("ratio"),
		denominator_unit: DenominatorUnit,
		scorecard_context: ScorecardContextSchema,
		reason: z.enum(["role_not_applicable", "zero_denominator"]),
		numerator: z.literal(0),
		denominator: z.literal(0),
		sample_count: z.literal(0),
		interval: z.strictObject({ state: z.literal("not_applicable") }),
	}),
]);
const DistributionSchema = z.strictObject({
	metric: z.enum([
		"input_tokens",
		"output_tokens",
		"total_tokens",
		"application_latency_ms",
		"provider_time_to_first_token_ms",
		"provider_total_time_ms",
	]),
	unit: z.enum(["tokens", "milliseconds"]),
	scorecard_context: ScorecardContextSchema,
	sample_count: Nonnegative,
	observed_sample_count: Nonnegative,
	unavailable_sample_count: Nonnegative,
	samples: z.array(z.strictObject({
		run_id: EvaluationIdSchema,
		trial_id: EvaluationIdSchema,
		invocation_id: EvaluationIdSchema,
		value: z.number().finite().nonnegative(),
	})),
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
const CriterionSummarySchema = z.strictObject({
	criterion: CriterionSchema,
	unit: z.literal("review_assessment"),
	sample_unit: z.literal("codex_reviewed_output"),
	scorecard_context: ScorecardContextSchema,
	sample_count: Nonnegative,
	counts: z.strictObject({
		meets: Nonnegative,
		partly_meets: Nonnegative,
		does_not_meet: Nonnegative,
		uncertain: Nonnegative,
	}),
	evidence: z.array(z.strictObject({
		review_id: EvaluationIdSchema,
		output: OutputIdentitySchema,
		assessment: AssessmentSchema,
		rationale: Trimmed,
		uncertainty: UncertaintySchema,
	})),
});
const ScorecardSchema = z.strictObject({
	production_step: CurrentProductionModelStepSchema,
	adapter: V8ModelAdapterConfigSchema,
	scorecard_context: ScorecardContextSchema,
	sample_counts: CountsSchema,
	rates: z.array(RateMetricSchema).length(5),
	distributions: z.array(DistributionSchema).length(6),
	qualitative: z.array(CriterionSummarySchema).length(4),
});
export const EvaluationScorecardArtifactSchema = z.strictObject({
	version: z.literal(4),
	id: EvaluationIdSchema,
	created_at: EvaluationTimestampSchema,
	source_reference: EvaluationLocalSourceReferenceSchema,
	corpus: z.strictObject({
		id: EvaluationIdSchema,
		fixture_count: z.number().int().positive(),
		source_reference: EvaluationLocalSourceReferenceSchema,
	}),
	configuration: z.strictObject({
		identity: EvaluationIdSchema,
		exact_config: EvalConfigSchema,
	}),
	repetition_count: z.number().int().positive(),
	sources: z.strictObject({
		benchmark_runs: z.array(z.strictObject({
			ordinal: z.number().int().positive(),
			corpus_fixture_id: Kebab,
			benchmark_run_id: EvaluationIdSchema,
			benchmark_run_version: z.literal(9),
			source_reference: EvaluationLocalSourceReferenceSchema,
			code_commit_sha: z.string().regex(/^[0-9a-f]{40}$/u),
			prepared_evidence_identity_sha256: Hash,
			output_contract_sha256s: z.array(Hash).length(2),
			transport_retry_limit: Nonnegative,
			gateway_request_sha256s: z.array(Hash),
		})),
		annotations: z.strictObject({
			source_reference: EvaluationLocalSourceReferenceSchema,
			bundle_id: EvaluationIdSchema,
			protocol_id: Trimmed,
			protocol_version: z.literal(3),
			annotator_id: Trimmed,
			annotator_kind: z.literal("codex"),
			annotated_at: EvaluationTimestampSchema,
		}),
		qualitative_reviews: z.strictObject({
			source_reference: EvaluationLocalSourceReferenceSchema,
			bundle_id: EvaluationIdSchema,
			rubric_id: Trimmed,
			rubric_version: z.literal(3),
			reviewer_id: Trimmed,
			reviewer_kind: z.literal("codex"),
			reviewed_at: EvaluationTimestampSchema,
		}),
	}),
	scorecards: z.array(ScorecardSchema).length(2),
});
export type EvaluationScorecardDeclaration = z.infer<typeof EvaluationScorecardDeclarationSchema>;
export type OutputIdentity = z.infer<typeof OutputIdentitySchema>;
export type AnnotationBundle = z.infer<typeof AnnotationBundleSchema>;
export type QualitativeReviewBundle = z.infer<typeof QualitativeReviewBundleSchema>;
export type EvaluationScorecardArtifact = z.infer<typeof EvaluationScorecardArtifactSchema>;
export type EvaluationRoleScorecard = EvaluationScorecardArtifact["scorecards"][number];
