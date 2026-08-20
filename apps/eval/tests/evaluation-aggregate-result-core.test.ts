import { expect, test } from "vitest";
import { buildEvaluationAggregateResult } from "../src/evaluation-aggregate-result-builder";
import {
	compareEvaluationAggregateResults,
	formatEvaluationAggregateResultComparison,
} from "../src/evaluation-aggregate-result-comparison";
import { formatEvaluationAggregateResultReport } from "../src/evaluation-aggregate-result-report";
import {
	AnyEvaluationAggregateResultSchema,
	EvaluationAggregateResultError,
	EvaluationAggregateResultSchema,
	EvaluationAggregateResultV1Schema,
	EvaluationAggregateResultV2Schema,
} from "../src/evaluation-aggregate-result";
import type { EvaluationScorecardArtifact } from "../src/evaluation-scorecard";

type AggregateSourceScorecard = Omit<EvaluationScorecardArtifact, "version" | "corpus"> & {
	readonly version: 4;
	readonly corpus: EvaluationScorecardArtifact["corpus"] & {
		readonly source_reference: {
			readonly path: string;
			readonly sha256: string;
		};
	};
};

const HASH = "1".repeat(64);
const ALT_HASH = "2".repeat(64);

const CURRENT_PRODUCTION_STEPS = {
	main_story_write: { adapter: "recorded" },
	announcements_write: {
		adapter: "openai_compatible_hosted",
		provider: "openai",
		model: "gpt-hosted",
		temperature: 0.2,
		billing: {
			method: "calculated",
			input_usd_per_million_tokens: 1,
			output_usd_per_million_tokens: 2,
			pricing_reference: "internal-rate-card",
		},
	},
} as const satisfies AggregateSourceScorecard["configuration"]["exact_config"]["production_steps"];

function sourceReference(path: string, sha256: string = HASH) {
	return { path, sha256 } as const;
}

function unknownContext() {
	return { state: "unknown" as const, reason: "no_captured_invocation" as const };
}

function currentRates(
	step: AggregateSourceScorecard["scorecards"][number]["production_step"],
): AggregateSourceScorecard["scorecards"][number]["rates"] {
	return [
		{
			state: "measured" as const,
			metric: "schema_reliability" as const,
			unit: "ratio" as const,
			denominator_unit: "terminal_provider_success_invocation" as const,
			scorecard_context: unknownContext(),
			numerator: 2,
			denominator: 3,
			sample_count: 3,
			value: 2 / 3,
			interval: { confidence: 0.95 as const, method: "wilson_score" as const, lower: 0.2, upper: 0.9 },
		},
		{
			state: "measured" as const,
			metric: "claim_grounding" as const,
			unit: "ratio" as const,
			denominator_unit: "codex_annotated_factual_claim" as const,
			scorecard_context: unknownContext(),
			numerator: 4,
			denominator: 5,
			sample_count: 5,
			value: 0.8,
			interval: { confidence: 0.95 as const, method: "wilson_score" as const, lower: 0.3, upper: 0.95 },
		},
		{
			state: "measured" as const,
			metric: "required_attribution" as const,
			unit: "ratio" as const,
			denominator_unit: "codex_annotated_required_attribution_claim" as const,
			scorecard_context: unknownContext(),
			numerator: 1,
			denominator: 2,
			sample_count: 2,
			value: 0.5,
			interval: { confidence: 0.95 as const, method: "wilson_score" as const, lower: 0.1, upper: 0.9 },
		},
		{
			state: "measured" as const,
			metric: "event_coverage" as const,
			unit: "ratio" as const,
			denominator_unit: "source_event_output_pair" as const,
			scorecard_context: unknownContext(),
			numerator: 3,
			denominator: 4,
			sample_count: 4,
			value: 0.75,
			interval: { confidence: 0.95 as const, method: "wilson_score" as const, lower: 0.2, upper: 0.96 },
		},
		step === "announcements_write"
			? {
				state: "measured" as const,
				metric: "announcement_relevance" as const,
				unit: "ratio" as const,
				denominator_unit: "parsed_announcement" as const,
				scorecard_context: unknownContext(),
				numerator: 5,
				denominator: 6,
				sample_count: 6,
				value: 5 / 6,
				interval: { confidence: 0.95 as const, method: "wilson_score" as const, lower: 0.4, upper: 0.98 },
			}
			: {
				state: "not_applicable" as const,
				metric: "announcement_relevance" as const,
				unit: "ratio" as const,
				denominator_unit: "parsed_announcement" as const,
				scorecard_context: unknownContext(),
				reason: "role_not_applicable" as const,
				numerator: 0 as const,
				denominator: 0 as const,
				sample_count: 0 as const,
				interval: { state: "not_applicable" as const },
			},
	];
}

function currentDistributions() {
	return [
		{ metric: "input_tokens" as const, unit: "tokens" as const, scorecard_context: unknownContext(), sample_count: 0, observed_sample_count: 0, unavailable_sample_count: 0, samples: [], summary: { state: "unavailable" as const } },
		{ metric: "output_tokens" as const, unit: "tokens" as const, scorecard_context: unknownContext(), sample_count: 0, observed_sample_count: 0, unavailable_sample_count: 0, samples: [], summary: { state: "unavailable" as const } },
		{ metric: "total_tokens" as const, unit: "tokens" as const, scorecard_context: unknownContext(), sample_count: 0, observed_sample_count: 0, unavailable_sample_count: 0, samples: [], summary: { state: "unavailable" as const } },
		{ metric: "application_latency_ms" as const, unit: "milliseconds" as const, scorecard_context: unknownContext(), sample_count: 0, observed_sample_count: 0, unavailable_sample_count: 0, samples: [], summary: { state: "unavailable" as const } },
		{ metric: "provider_time_to_first_token_ms" as const, unit: "milliseconds" as const, scorecard_context: unknownContext(), sample_count: 0, observed_sample_count: 0, unavailable_sample_count: 0, samples: [], summary: { state: "unavailable" as const } },
		{ metric: "provider_total_time_ms" as const, unit: "milliseconds" as const, scorecard_context: unknownContext(), sample_count: 0, observed_sample_count: 0, unavailable_sample_count: 0, samples: [], summary: { state: "unavailable" as const } },
	];
}

function currentQualitative() {
	return [
		{ criterion: "coherence" as const, unit: "review_assessment" as const, sample_unit: "codex_reviewed_output" as const, scorecard_context: unknownContext(), sample_count: 0, counts: { meets: 0, partly_meets: 0, does_not_meet: 0, uncertain: 0 }, evidence: [] },
		{ criterion: "usefulness" as const, unit: "review_assessment" as const, sample_unit: "codex_reviewed_output" as const, scorecard_context: unknownContext(), sample_count: 0, counts: { meets: 0, partly_meets: 0, does_not_meet: 0, uncertain: 0 }, evidence: [] },
		{ criterion: "newsworthiness" as const, unit: "review_assessment" as const, sample_unit: "codex_reviewed_output" as const, scorecard_context: unknownContext(), sample_count: 0, counts: { meets: 0, partly_meets: 0, does_not_meet: 0, uncertain: 0 }, evidence: [] },
		{ criterion: "voice" as const, unit: "review_assessment" as const, sample_unit: "codex_reviewed_output" as const, scorecard_context: unknownContext(), sample_count: 0, counts: { meets: 0, partly_meets: 0, does_not_meet: 0, uncertain: 0 }, evidence: [] },
	];
}

function currentScorecard(
	step: AggregateSourceScorecard["scorecards"][number]["production_step"],
): AggregateSourceScorecard["scorecards"][number] {
	return {
		production_step: step,
		adapter: CURRENT_PRODUCTION_STEPS[step],
		scorecard_context: unknownContext(),
		sample_counts: {
			declared_trial_count: 3,
			step_reached_trial_count: 3,
			step_not_reached_trial_count: 0,
			invocation_attempt_count: 3,
			initial_attempt_count: 3,
			retry_attempt_count: 0,
			transport_failed_attempt_count: 0,
			transport_succeeded_attempt_count: 3,
			parse_succeeded_invocation_count: 3,
			parse_rejected_invocation_count: 0,
			annotated_output_count: 3,
			reviewed_output_count: 3,
		},
		rates: currentRates(step),
		distributions: currentDistributions(),
		qualitative: currentQualitative(),
	};
}

function aggregateSource(sourceSha256: string = HASH): AggregateSourceScorecard {
	return {
		version: 4,
		id: "scorecard-one",
		created_at: "2026-08-17T12:00:00.000Z",
		source_reference: sourceReference("scorecards/scorecard-one.json"),
		corpus: {
			id: "corpus-one",
			fixture_count: 6,
			source_reference: sourceReference("corpus/manifest.json", sourceSha256),
		},
		configuration: {
			identity: "config-one",
			exact_config: { production_steps: CURRENT_PRODUCTION_STEPS },
		},
		repetition_count: 1,
		sources: {
			benchmark_runs: [{
				ordinal: 1,
				corpus_fixture_id: "fixture-one",
				benchmark_run_id: "benchmark-one",
				benchmark_run_version: 9 as const,
				source_reference: sourceReference("runs/benchmark-one.json"),
				code_commit_sha: "4".repeat(40),
				prepared_evidence_identity_sha256: HASH,
				output_contract_sha256s: [HASH, ALT_HASH],
				transport_retry_limit: 0,
				gateway_request_sha256s: [HASH],
			}],
			annotations: {
				source_reference: sourceReference("codex/annotations.json"),
				bundle_id: "annotations-one",
				protocol_id: "bc-news-output-annotation",
				protocol_version: 3 as const,
				annotator_id: "codex",
				annotator_kind: "codex" as const,
				annotated_at: "2026-08-17T11:00:00.000Z",
			},
			qualitative_reviews: {
				source_reference: sourceReference("codex/reviews.json"),
				bundle_id: "reviews-one",
				rubric_id: "bc-news-editorial-qualitative",
				rubric_version: 3 as const,
				reviewer_id: "codex",
				reviewer_kind: "codex" as const,
				reviewed_at: "2026-08-17T11:05:00.000Z",
			},
		},
		scorecards: [
			currentScorecard("main_story_write"),
			currentScorecard("announcements_write"),
		],
	};
}

function historicalRoles() {
	const subject = {
		main_story_write: { adapter: "recorded" as const },
		main_story_copyedit: { adapter: "lmstudio" as const, model: "lmstudio-model", temperature: 0.4, reasoning_effort: "provider_default" as const },
		announcements_write: { adapter: "openai_compatible_hosted" as const, provider: "openai", model: "gpt-hosted", temperature: 0.2 },
		announcements_copyedit: { adapter: "cloudflare_ai_gateway" as const, model: "@cf/meta/llama", temperature: 0.1 },
	} as const;
	const steps = [
		"main_story_write",
		"main_story_copyedit",
		"announcements_write",
		"announcements_copyedit",
	] as const;
	return steps.map((step) => ({
		production_step: step,
		subject: subject[step],
		sample_counts: {
			declared_trial_count: 3,
			step_reached_trial_count: 3,
			step_not_reached_trial_count: 0,
			invocation_attempt_count: 3,
			initial_attempt_count: 3,
			retry_attempt_count: 0,
			transport_failed_attempt_count: 0,
			transport_succeeded_attempt_count: 3,
			parse_succeeded_invocation_count: 3,
			parse_rejected_invocation_count: 0,
			annotated_output_count: 3,
			reviewed_output_count: 3,
		},
		rates: [
			{ state: "measured" as const, metric: "schema_reliability" as const, unit: "ratio" as const, denominator_unit: "terminal_provider_success_invocation" as const, numerator: 2, denominator: 3, sample_count: 3, value: 2 / 3, interval: { confidence: 0.95 as const, method: "wilson_score" as const, lower: 0.2, upper: 0.9 } },
			step.includes("copyedit")
				? { state: "measured" as const, metric: "copyedit_preservation" as const, unit: "ratio" as const, denominator_unit: "parse_success_copyedit_output" as const, numerator: 3, denominator: 4, sample_count: 4, value: 0.75, interval: { confidence: 0.95 as const, method: "wilson_score" as const, lower: 0.3, upper: 0.95 } }
				: { state: "not_applicable" as const, metric: "copyedit_preservation" as const, unit: "ratio" as const, denominator_unit: "parse_success_copyedit_output" as const, reason: "role_not_applicable" as const, numerator: 0 as const, denominator: 0 as const, sample_count: 0 as const, interval: { state: "not_applicable" as const } },
			{ state: "measured" as const, metric: "claim_grounding" as const, unit: "ratio" as const, denominator_unit: "codex_annotated_factual_claim" as const, numerator: 4, denominator: 5, sample_count: 5, value: 0.8, interval: { confidence: 0.95 as const, method: "wilson_score" as const, lower: 0.3, upper: 0.95 } },
			{ state: "measured" as const, metric: "required_attribution" as const, unit: "ratio" as const, denominator_unit: "codex_annotated_required_attribution_claim" as const, numerator: 1, denominator: 2, sample_count: 2, value: 0.5, interval: { confidence: 0.95 as const, method: "wilson_score" as const, lower: 0.1, upper: 0.9 } },
			{ state: "measured" as const, metric: "event_coverage" as const, unit: "ratio" as const, denominator_unit: "source_event_output_pair" as const, numerator: 3, denominator: 4, sample_count: 4, value: 0.75, interval: { confidence: 0.95 as const, method: "wilson_score" as const, lower: 0.2, upper: 0.96 } },
			step === "announcements_write" || step === "announcements_copyedit"
				? { state: "measured" as const, metric: "announcement_relevance" as const, unit: "ratio" as const, denominator_unit: "parsed_announcement" as const, numerator: 5, denominator: 6, sample_count: 6, value: 5 / 6, interval: { confidence: 0.95 as const, method: "wilson_score" as const, lower: 0.4, upper: 0.98 } }
				: { state: "not_applicable" as const, metric: "announcement_relevance" as const, unit: "ratio" as const, denominator_unit: "parsed_announcement" as const, reason: "role_not_applicable" as const, numerator: 0 as const, denominator: 0 as const, sample_count: 0 as const, interval: { state: "not_applicable" as const } },
		],
		distributions: [
			{ metric: "input_tokens" as const, unit: "tokens" as const, sample_count: 0, observed_sample_count: 0, unavailable_sample_count: 0, summary: { state: "unavailable" as const } },
			{ metric: "output_tokens" as const, unit: "tokens" as const, sample_count: 0, observed_sample_count: 0, unavailable_sample_count: 0, summary: { state: "unavailable" as const } },
			{ metric: "total_tokens" as const, unit: "tokens" as const, sample_count: 0, observed_sample_count: 0, unavailable_sample_count: 0, summary: { state: "unavailable" as const } },
			{ metric: "application_latency_ms" as const, unit: "milliseconds" as const, sample_count: 0, observed_sample_count: 0, unavailable_sample_count: 0, summary: { state: "unavailable" as const } },
			{ metric: "provider_time_to_first_token_ms" as const, unit: "milliseconds" as const, sample_count: 0, observed_sample_count: 0, unavailable_sample_count: 0, summary: { state: "unavailable" as const } },
			{ metric: "provider_total_time_ms" as const, unit: "milliseconds" as const, sample_count: 0, observed_sample_count: 0, unavailable_sample_count: 0, summary: { state: "unavailable" as const } },
		],
		qualitative: [
			{ criterion: "coherence" as const, unit: "review_assessment" as const, sample_unit: "codex_reviewed_output" as const, sample_count: 0, counts: { meets: 0, partly_meets: 0, does_not_meet: 0, uncertain: 0 } },
			{ criterion: "usefulness" as const, unit: "review_assessment" as const, sample_unit: "codex_reviewed_output" as const, sample_count: 0, counts: { meets: 0, partly_meets: 0, does_not_meet: 0, uncertain: 0 } },
			{ criterion: "newsworthiness" as const, unit: "review_assessment" as const, sample_unit: "codex_reviewed_output" as const, sample_count: 0, counts: { meets: 0, partly_meets: 0, does_not_meet: 0, uncertain: 0 } },
			{ criterion: "voice" as const, unit: "review_assessment" as const, sample_unit: "codex_reviewed_output" as const, sample_count: 0, counts: { meets: 0, partly_meets: 0, does_not_meet: 0, uncertain: 0 } },
		],
	}));
}

function historicalAggregateV1() {
	return EvaluationAggregateResultV1Schema.parse({
		version: 1,
		id: "aggregate-v1",
		created_at: "2026-08-17T11:30:00.000Z",
		evidence_retention: "local_only",
		source_scorecard: {
			version: 2,
			id: "historical-scorecard-v2",
			created_at: "2026-08-17T10:30:00.000Z",
		},
		cohort: {
			id: "cohort-one",
			fixture_count: 6,
			repetition_count: 1,
		},
		configuration_identity: "config-one",
		roles: historicalRoles(),
	});
}

function historicalAggregateV2() {
	return EvaluationAggregateResultV2Schema.parse({
		version: 2,
		id: "aggregate-v2",
		created_at: "2026-08-17T11:45:00.000Z",
		evidence_retention: "local_only",
		source_scorecard: {
			version: 3,
			id: "historical-scorecard-v3",
			created_at: "2026-08-17T10:45:00.000Z",
		},
		cohort: {
			id: "cohort-one",
			evidence_identity_sha256: HASH,
			fixture_count: 6,
			repetition_count: 1,
		},
		configuration_identity: "config-one",
		roles: historicalRoles(),
	});
}

test("builds a strict v3 aggregate projection with current scorecard provenance", () => {
	const aggregate = buildEvaluationAggregateResult(aggregateSource(), {
		id: "aggregate-one",
		createdAt: "2026-08-17T12:30:00.000Z",
		cohortId: "corpus-one",
		rawMessageCount: 385,
		preparedMessageCount: 149,
	});
	const [mainStoryWrite, announcementsWrite] = aggregate.roles;

	expect(EvaluationAggregateResultSchema.safeParse(aggregate).success).toBe(true);
	expect(AnyEvaluationAggregateResultSchema.safeParse(aggregate).success).toBe(true);
	expect(aggregate).toMatchObject({
		version: 3,
		id: "aggregate-one",
		evidence_retention: "local_only",
		source_scorecard: {
			version: 4,
			id: "scorecard-one",
			benchmark_run_version: 9,
			annotation_protocol: { id: "bc-news-output-annotation", version: 3 },
			qualitative_rubric: { id: "bc-news-editorial-qualitative", version: 3 },
		},
		cohort: {
			id: "corpus-one",
			evidence_identity_sha256: HASH,
			fixture_count: 6,
			repetition_count: 1,
			raw_message_count: 385,
			prepared_message_count: 149,
		},
		configuration_identity: "config-one",
	});
	expect(aggregate).not.toHaveProperty("source_reference");
	expect(aggregate.roles.map((role) => role.production_step)).toEqual([
		"main_story_write",
		"announcements_write",
	]);
	expect(mainStoryWrite.subject).toEqual({ adapter: "recorded" });
	expect(announcementsWrite.subject).toEqual({
		adapter: "openai_compatible_hosted",
		provider: "openai",
		model: "gpt-hosted",
		temperature: 0.2,
	});
	expect(mainStoryWrite.rates).toHaveLength(5);
	expect(announcementsWrite.subject).not.toHaveProperty("billing");
	expect(mainStoryWrite.rates[0]).not.toHaveProperty("scorecard_context");
	expect(mainStoryWrite.distributions[0]).not.toHaveProperty("samples");
	expect(mainStoryWrite.qualitative[0]).not.toHaveProperty("evidence");
	expect(EvaluationAggregateResultSchema.safeParse({
		...aggregate,
		source_reference: { repository: "bc-news", commit_sha: "5".repeat(40), path: "private.json" },
	}).success).toBe(false);
});

test("rejects aggregate cohort ids that do not match the source corpus id", () => {
	expect(() => buildEvaluationAggregateResult(
		aggregateSource(),
		{ id: "aggregate-one", createdAt: "2026-08-17T12:30:00.000Z", cohortId: "cohort-one" },
	)).toThrowError(EvaluationAggregateResultError);
	try {
		buildEvaluationAggregateResult(
			aggregateSource(),
			{ id: "aggregate-one", createdAt: "2026-08-17T12:30:00.000Z", cohortId: "cohort-one" },
		);
	} catch (error) {
		expect(error).toBeInstanceOf(EvaluationAggregateResultError);
		expect((error as EvaluationAggregateResultError).code).toBe("aggregate_creation_rejected");
		expect((error as EvaluationAggregateResultError).message).toContain("Aggregate cohort id must match source scorecard corpus id corpus-one");
	}
});

test("rejects historical scorecard sources for current aggregate builds", () => {
	expect(() => buildEvaluationAggregateResult(
		{
			...aggregateSource(),
			version: 3,
		} as unknown as EvaluationScorecardArtifact,
		{ id: "aggregate-one", createdAt: "2026-08-17T12:30:00.000Z", cohortId: "corpus-one" },
	)).toThrowError(EvaluationAggregateResultError);
	try {
		buildEvaluationAggregateResult(
			{
				...aggregateSource(),
				version: 3,
			} as unknown as EvaluationScorecardArtifact,
			{ id: "aggregate-one", createdAt: "2026-08-17T12:30:00.000Z", cohortId: "corpus-one" },
		);
	} catch (error) {
		expect(error).toBeInstanceOf(EvaluationAggregateResultError);
		expect((error as EvaluationAggregateResultError).code).toBe("unsupported_source_scorecard_version");
		expect((error as EvaluationAggregateResultError).message).toContain("supports Evaluation Scorecard version 4 only");
	}
});

test("keeps historical v1 and v2 aggregate readers explicit while current reports expose v3 provenance", () => {
	const current = buildEvaluationAggregateResult(aggregateSource(HASH), {
		id: "aggregate-left",
		createdAt: "2026-08-17T13:00:00.000Z",
		cohortId: "corpus-one",
	});
	const drifted = buildEvaluationAggregateResult(aggregateSource(ALT_HASH), {
		id: "aggregate-right",
		createdAt: "2026-08-17T13:01:00.000Z",
		cohortId: "corpus-one",
	});

	expect(AnyEvaluationAggregateResultSchema.safeParse(historicalAggregateV1()).success).toBe(true);
	expect(AnyEvaluationAggregateResultSchema.safeParse(historicalAggregateV2()).success).toBe(true);

	const report = formatEvaluationAggregateResultReport(current);
	expect(report).toContain("Evaluation aggregate result v3: aggregate-left");
	expect(report).toContain("Benchmark Run version: v9");
	expect(report).toContain("Annotation protocol: bc-news-output-annotation v3");
	expect(report).toContain("Qualitative rubric: bc-news-editorial-qualitative v3");
	expect(report).not.toContain("Role: main_story_copyedit");
	expect(report).not.toContain("Role: announcements_copyedit");

	const comparison = compareEvaluationAggregateResults(current, drifted);
	expect(comparison.differences).toContain("aggregate.cohort.evidence_identity_sha256");
	const comparisonText = formatEvaluationAggregateResultComparison(comparison);
	expect(comparisonText).toContain("Aggregate differences:");
	expect(comparisonText).toContain("aggregate.cohort.evidence_identity_sha256");
});
