import { z } from "zod";
import {
	EvaluationAggregateResultSchema,
	EvaluationAggregateResultError,
	type EvaluationAggregateResult,
	type EvaluationAggregateSubjectDescriptor,
} from "./evaluation-aggregate-result";
import { EvaluationIdSchema, EvaluationTimestampSchema } from "./evaluation-artifact-schemas";
import type { EvaluationRoleScorecard, EvaluationScorecardArtifact } from "./evaluation-scorecard";
import { type CurrentProductionModelStep } from "./current-production-steps";

const ROLE_STEPS = [
	"main_story_write",
	"announcements_write",
] as const satisfies readonly CurrentProductionModelStep[];
const RATE_DEFINITIONS = [
	["schema_reliability", "terminal_provider_success_invocation"],
	["claim_grounding", "codex_annotated_factual_claim"],
	["required_attribution", "codex_annotated_required_attribution_claim"],
	["event_coverage", "source_event_output_pair"],
	["announcement_relevance", "parsed_announcement"],
] as const;
const DISTRIBUTIONS = [
	["input_tokens", "tokens"],
	["output_tokens", "tokens"],
	["total_tokens", "tokens"],
	["application_latency_ms", "milliseconds"],
	["provider_time_to_first_token_ms", "milliseconds"],
	["provider_total_time_ms", "milliseconds"],
] as const;
const CRITERIA = ["coherence", "usefulness", "newsworthiness", "voice"] as const;

const BuildEvaluationAggregateResultOptionsSchema = z.strictObject({
	id: EvaluationIdSchema,
	createdAt: EvaluationTimestampSchema,
	cohortId: EvaluationIdSchema,
	rawMessageCount: z.number().int().nonnegative().optional(),
	preparedMessageCount: z.number().int().nonnegative().optional(),
});

const AggregateSourceScorecardSchema = z.object({
	version: z.literal(4),
	id: EvaluationIdSchema,
	created_at: EvaluationTimestampSchema,
	corpus: z.object({
		id: EvaluationIdSchema,
		fixture_count: z.number().int().positive(),
		source_reference: z.object({
			sha256: z.string().regex(/^[0-9a-f]{64}$/u),
		}),
	}),
	configuration: z.object({ identity: EvaluationIdSchema }),
	repetition_count: z.number().int().positive(),
	sources: z.object({
		benchmark_runs: z.array(z.object({
			benchmark_run_version: z.literal(9),
		})).min(1),
		annotations: z.object({
			protocol_id: z.string().min(1),
			protocol_version: z.literal(3),
		}),
		qualitative_reviews: z.object({
			rubric_id: z.string().min(1),
			rubric_version: z.literal(3),
		}),
	}),
	scorecards: z.array(z.unknown()).length(2),
});

type AggregateSourceScorecard = Omit<EvaluationScorecardArtifact, "version" | "corpus"> & {
	readonly version: 4;
	readonly corpus: EvaluationScorecardArtifact["corpus"] & {
		readonly source_reference: {
			readonly sha256: string;
		};
	};
};

function fail(code: EvaluationAggregateResultError["code"], path: string, message: string): never {
	throw new EvaluationAggregateResultError(code, path, message);
}

function only<T>(items: readonly T[], code: EvaluationAggregateResultError["code"], path: string, message: string): T {
	if (items.length !== 1) fail(code, path, message);
	return items[0]!;
}

function assertCurrentSourceScorecard(scorecard: unknown): AggregateSourceScorecard {
	if (typeof scorecard !== "object" || scorecard === null || !("version" in scorecard) || scorecard.version !== 4) {
		const candidate = typeof scorecard === "object" && scorecard !== null && "version" in scorecard
			? `v${String(scorecard.version)}`
			: "unknown";
		fail("unsupported_source_scorecard_version", "unknown-scorecard", `Aggregate result supports Evaluation Scorecard version 4 only, received ${candidate}`);
	}
	const parsed = AggregateSourceScorecardSchema.safeParse(scorecard);
	if (!parsed.success) {
		fail("aggregate_creation_rejected", parsed.error.issues[0]?.path.join(".") ?? "scorecard", `Aggregate result requires the current scorecard v4 cohort witness: ${parsed.error.message}`);
	}
	return scorecard as AggregateSourceScorecard;
}

function roleScorecard(scorecard: AggregateSourceScorecard, step: CurrentProductionModelStep): EvaluationRoleScorecard {
	return only(
		scorecard.scorecards.filter((candidate) => candidate.production_step === step),
		"aggregate_role_roster_mismatch",
		scorecard.id,
		`Aggregate result requires exactly one ${step} scorecard`,
	);
}

function subjectDescriptor(source: EvaluationRoleScorecard["adapter"]): EvaluationAggregateSubjectDescriptor {
	switch (source.adapter) {
		case "recorded":
			return { adapter: "recorded" };
		case "lmstudio":
			return lmStudioSubjectDescriptor(source);
		case "openai_compatible_hosted":
			return {
				adapter: "openai_compatible_hosted",
				provider: source.provider,
				model: source.model,
				...(source.temperature === undefined ? {} : { temperature: source.temperature }),
			};
		case "cloudflare_ai_gateway":
			return {
				adapter: "cloudflare_ai_gateway",
				model: source.model,
				...(source.temperature === undefined ? {} : { temperature: source.temperature }),
			};
	}
}

function lmStudioSubjectDescriptor(
	source: Extract<EvaluationRoleScorecard["adapter"], { readonly adapter: "lmstudio" }>,
): Extract<EvaluationAggregateSubjectDescriptor, { readonly adapter: "lmstudio" }> {
	const subject: Extract<EvaluationAggregateSubjectDescriptor, { adapter: "lmstudio" }> = {
		adapter: "lmstudio",
		model: source.model,
		reasoning_effort: source.reasoning_effort,
	};
	if (source.temperature !== undefined) subject.temperature = source.temperature;
	if (source.top_p !== undefined) subject.top_p = source.top_p;
	if (source.top_k !== undefined) subject.top_k = source.top_k;
	if (source.enable_thinking !== undefined) subject.enable_thinking = source.enable_thinking;
	return subject;
}

function sampleCounts(source: EvaluationRoleScorecard["sample_counts"]) {
	return {
		declared_trial_count: source.declared_trial_count,
		step_reached_trial_count: source.step_reached_trial_count,
		step_not_reached_trial_count: source.step_not_reached_trial_count,
		invocation_attempt_count: source.invocation_attempt_count,
		initial_attempt_count: source.initial_attempt_count,
		retry_attempt_count: source.retry_attempt_count,
		transport_failed_attempt_count: source.transport_failed_attempt_count,
		transport_succeeded_attempt_count: source.transport_succeeded_attempt_count,
		parse_succeeded_invocation_count: source.parse_succeeded_invocation_count,
		parse_rejected_invocation_count: source.parse_rejected_invocation_count,
		annotated_output_count: source.annotated_output_count,
		reviewed_output_count: source.reviewed_output_count,
	};
}

function projectedRate(
	scorecard: AggregateSourceScorecard,
	step: CurrentProductionModelStep,
	source: EvaluationRoleScorecard["rates"][number],
	expectedMetric: (typeof RATE_DEFINITIONS)[number][0],
	expectedDenominatorUnit: (typeof RATE_DEFINITIONS)[number][1],
) {
	if (source.metric !== expectedMetric || source.denominator_unit !== expectedDenominatorUnit) {
		fail("aggregate_rate_roster_mismatch", scorecard.id, `Aggregate role ${step} must retain the fixed rate roster`);
	}
	if (source.state === "measured") {
		return {
			state: "measured" as const,
			metric: source.metric,
			unit: source.unit,
			denominator_unit: source.denominator_unit,
			numerator: source.numerator,
			denominator: source.denominator,
			sample_count: source.sample_count,
			value: source.value,
			interval: {
				confidence: source.interval.confidence,
				method: source.interval.method,
				lower: source.interval.lower,
				upper: source.interval.upper,
			},
		};
	}
	return {
		state: "not_applicable" as const,
		metric: source.metric,
		unit: source.unit,
		denominator_unit: source.denominator_unit,
		reason: source.reason,
		numerator: source.numerator,
		denominator: source.denominator,
		sample_count: source.sample_count,
		interval: { state: "not_applicable" as const },
	};
}

function projectedDistribution(
	scorecard: AggregateSourceScorecard,
	step: CurrentProductionModelStep,
	source: EvaluationRoleScorecard["distributions"][number],
	expectedMetric: (typeof DISTRIBUTIONS)[number][0],
	expectedUnit: (typeof DISTRIBUTIONS)[number][1],
) {
	if (source.metric !== expectedMetric || source.unit !== expectedUnit) {
		fail("aggregate_distribution_roster_mismatch", scorecard.id, `Aggregate role ${step} must retain the fixed distribution roster`);
	}
	return {
		metric: source.metric,
		unit: source.unit,
		sample_count: source.sample_count,
		observed_sample_count: source.observed_sample_count,
		unavailable_sample_count: source.unavailable_sample_count,
		summary: source.summary.state === "measured"
			? {
				state: "measured" as const,
				min: source.summary.min,
				median: source.summary.median,
				mean: source.summary.mean,
				max: source.summary.max,
			}
			: { state: "unavailable" as const },
	};
}

function projectedQualitative(
	scorecard: AggregateSourceScorecard,
	step: CurrentProductionModelStep,
	source: EvaluationRoleScorecard["qualitative"][number],
	expectedCriterion: (typeof CRITERIA)[number],
) {
	if (source.criterion !== expectedCriterion) {
		fail("aggregate_qualitative_roster_mismatch", scorecard.id, `Aggregate role ${step} must retain the fixed qualitative roster`);
	}
	return {
		criterion: source.criterion,
		unit: source.unit,
		sample_unit: source.sample_unit,
		sample_count: source.sample_count,
		counts: {
			meets: source.counts.meets,
			partly_meets: source.counts.partly_meets,
			does_not_meet: source.counts.does_not_meet,
			uncertain: source.counts.uncertain,
		},
	};
}

function roleAggregate(scorecard: AggregateSourceScorecard, step: CurrentProductionModelStep) {
	const source = roleScorecard(scorecard, step);
	return {
		production_step: step,
		subject: subjectDescriptor(source.adapter),
		sample_counts: sampleCounts(source.sample_counts),
		rates: RATE_DEFINITIONS.map(([metric, denominatorUnit]) => projectedRate(
			scorecard,
			step,
			only(
				source.rates.filter((candidate) => candidate.metric === metric),
				"aggregate_rate_roster_mismatch",
				scorecard.id,
				`Aggregate role ${step} requires exactly one ${metric} rate`,
			),
			metric,
			denominatorUnit,
		)),
		distributions: DISTRIBUTIONS.map(([metric, unit]) => projectedDistribution(
			scorecard,
			step,
			only(
				source.distributions.filter((candidate) => candidate.metric === metric),
				"aggregate_distribution_roster_mismatch",
				scorecard.id,
				`Aggregate role ${step} requires exactly one ${metric} distribution`,
			),
			metric,
			unit,
		)),
		qualitative: CRITERIA.map((criterion) => projectedQualitative(
			scorecard,
			step,
			only(
				source.qualitative.filter((candidate) => candidate.criterion === criterion),
				"aggregate_qualitative_roster_mismatch",
				scorecard.id,
				`Aggregate role ${step} requires exactly one ${criterion} qualitative summary`,
			),
			criterion,
		)),
	};
}

export function buildEvaluationAggregateResult(
	scorecard: EvaluationScorecardArtifact | AggregateSourceScorecard,
	options: {
		readonly id: string;
		readonly createdAt: string;
		readonly cohortId: string;
		readonly rawMessageCount?: number;
		readonly preparedMessageCount?: number;
	},
): EvaluationAggregateResult {
	const currentScorecard = assertCurrentSourceScorecard(scorecard);
	const parsedOptions = BuildEvaluationAggregateResultOptionsSchema.safeParse(options);
	if (!parsedOptions.success) {
		fail("aggregate_creation_rejected", currentScorecard.id, `Aggregate result options are invalid: ${parsedOptions.error.message}`);
	}
	if (parsedOptions.data.cohortId !== currentScorecard.corpus.id) {
		fail(
			"aggregate_creation_rejected",
			currentScorecard.id,
			`Aggregate cohort id must match source scorecard corpus id ${currentScorecard.corpus.id}, received ${parsedOptions.data.cohortId}`,
		);
	}
	if (Date.parse(parsedOptions.data.createdAt) < Date.parse(currentScorecard.created_at)) {
		fail("aggregate_chronology_mismatch", currentScorecard.id, "Aggregate creation cannot predate its source scorecard");
	}
	const candidate = {
		version: 3 as const,
		id: parsedOptions.data.id,
		created_at: parsedOptions.data.createdAt,
		evidence_retention: "local_only" as const,
		source_scorecard: {
			version: 4 as const,
			id: currentScorecard.id,
			created_at: currentScorecard.created_at,
			benchmark_run_version: 9 as const,
			annotation_protocol: {
				id: currentScorecard.sources.annotations.protocol_id,
				version: currentScorecard.sources.annotations.protocol_version,
			},
			qualitative_rubric: {
				id: currentScorecard.sources.qualitative_reviews.rubric_id,
				version: currentScorecard.sources.qualitative_reviews.rubric_version,
			},
		},
		cohort: {
			id: parsedOptions.data.cohortId,
			evidence_identity_sha256: currentScorecard.corpus.source_reference.sha256,
			fixture_count: currentScorecard.corpus.fixture_count,
			repetition_count: currentScorecard.repetition_count,
			...(parsedOptions.data.rawMessageCount === undefined ? {} : { raw_message_count: parsedOptions.data.rawMessageCount }),
			...(parsedOptions.data.preparedMessageCount === undefined ? {} : { prepared_message_count: parsedOptions.data.preparedMessageCount }),
		},
		configuration_identity: currentScorecard.configuration.identity,
		roles: ROLE_STEPS.map((step) => roleAggregate(currentScorecard, step)),
	};
	const result = EvaluationAggregateResultSchema.safeParse(candidate);
	if (!result.success) {
		fail("aggregate_artifact_tampered", currentScorecard.id, `Built aggregate result violated its contract: ${result.error.message}`);
	}
	return result.data;
}
