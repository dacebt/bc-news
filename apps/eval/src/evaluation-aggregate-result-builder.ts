import { z } from "zod";
import type { ProductionModelStep } from "@bc-news/generation-core";
import {
	EvaluationAggregateResultSchema,
	EvaluationAggregateResultError,
	type EvaluationAggregateResult,
	type EvaluationAggregateSubjectDescriptor,
} from "./evaluation-aggregate-result";
import { EvaluationIdSchema, EvaluationTimestampSchema } from "./evaluation-artifact-schemas";
import type { EvaluationRoleScorecard, EvaluationScorecardArtifact } from "./evaluation-scorecard";

const ROLE_STEPS = [
	"main_story_write",
	"main_story_copyedit",
	"announcements_write",
	"announcements_copyedit",
] as const satisfies readonly ProductionModelStep[];
const RATE_DEFINITIONS = [
	["schema_reliability", "terminal_provider_success_invocation"],
	["copyedit_preservation", "parse_success_copyedit_output"],
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

function fail(code: EvaluationAggregateResultError["code"], path: string, message: string): never {
	throw new EvaluationAggregateResultError(code, path, message);
}

function only<T>(items: readonly T[], code: EvaluationAggregateResultError["code"], path: string, message: string): T {
	if (items.length !== 1) fail(code, path, message);
	return items[0]!;
}

function roleScorecard(scorecard: EvaluationScorecardArtifact, step: ProductionModelStep): EvaluationRoleScorecard {
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
			return {
				adapter: "lmstudio",
				model: source.model,
				...(source.temperature === undefined ? {} : { temperature: source.temperature }),
				reasoning_effort: source.reasoning_effort,
			};
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
	scorecard: EvaluationScorecardArtifact,
	step: ProductionModelStep,
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
	scorecard: EvaluationScorecardArtifact,
	step: ProductionModelStep,
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
	scorecard: EvaluationScorecardArtifact,
	step: ProductionModelStep,
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

function roleAggregate(scorecard: EvaluationScorecardArtifact, step: ProductionModelStep) {
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
	scorecard: EvaluationScorecardArtifact,
	options: {
		readonly id: string;
		readonly createdAt: string;
		readonly cohortId: string;
		readonly rawMessageCount?: number;
		readonly preparedMessageCount?: number;
	},
): EvaluationAggregateResult {
	if (scorecard.version !== 2) {
		fail("unsupported_source_scorecard_version", scorecard.id, `Aggregate result supports Evaluation Scorecard version 2 only, received v${String(scorecard.version)}`);
	}
	const parsedOptions = BuildEvaluationAggregateResultOptionsSchema.safeParse(options);
	if (!parsedOptions.success) {
		fail("aggregate_creation_rejected", scorecard.id, `Aggregate result options are invalid: ${parsedOptions.error.message}`);
	}
	if (parsedOptions.data.cohortId !== scorecard.corpus.id) {
		fail(
			"aggregate_creation_rejected",
			scorecard.id,
			`Aggregate cohort id must match source scorecard corpus id ${scorecard.corpus.id}, received ${parsedOptions.data.cohortId}`,
		);
	}
	if (Date.parse(parsedOptions.data.createdAt) < Date.parse(scorecard.created_at)) {
		fail("aggregate_chronology_mismatch", scorecard.id, "Aggregate creation cannot predate its source scorecard");
	}
	const candidate = {
		version: 1 as const,
		id: parsedOptions.data.id,
		created_at: parsedOptions.data.createdAt,
		evidence_retention: "local_only" as const,
		source_scorecard: {
			version: 2 as const,
			id: scorecard.id,
			created_at: scorecard.created_at,
		},
		cohort: {
			id: parsedOptions.data.cohortId,
			fixture_count: scorecard.corpus.fixture_count,
			repetition_count: scorecard.repetition_count,
			...(parsedOptions.data.rawMessageCount === undefined ? {} : { raw_message_count: parsedOptions.data.rawMessageCount }),
			...(parsedOptions.data.preparedMessageCount === undefined ? {} : { prepared_message_count: parsedOptions.data.preparedMessageCount }),
		},
		configuration_identity: scorecard.configuration.identity,
		roles: ROLE_STEPS.map((step) => roleAggregate(scorecard, step)),
	};
	const result = EvaluationAggregateResultSchema.safeParse(candidate);
	if (!result.success) {
		fail("aggregate_artifact_tampered", scorecard.id, `Built aggregate result violated its contract: ${result.error.message}`);
	}
	return result.data;
}
