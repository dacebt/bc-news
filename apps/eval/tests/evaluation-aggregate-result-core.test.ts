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
} from "../src/evaluation-aggregate-result";
import type { EvaluationScorecardArtifact } from "../src/evaluation-scorecard";

type AggregateSourceScorecard = Omit<EvaluationScorecardArtifact, "version" | "corpus"> & {
	readonly version: 3;
	readonly corpus: EvaluationScorecardArtifact["corpus"] & {
		readonly source_reference: {
			readonly path: string;
			readonly sha256: string;
		};
	};
};

const HASH = "1".repeat(64);
const ALT_HASH = "2".repeat(64);
const PRODUCTION_STEPS = {
	main_story_write: { adapter: "recorded" },
	main_story_copyedit: { adapter: "lmstudio", model: "lmstudio-model", temperature: 0.4, reasoning_effort: "provider_default" },
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
	announcements_copyedit: {
		adapter: "cloudflare_ai_gateway",
		gateway: { selection: "named", id: "private-gateway" },
		model: "@cf/meta/llama",
		temperature: 0.1,
	},
} as const satisfies AggregateSourceScorecard["configuration"]["exact_config"]["production_steps"];

function sourceReference(path: string, sha256: string = HASH) {
	return { path, sha256 } as const;
}

function unknownContext() {
	return { state: "unknown" as const, reason: "no_captured_invocation" as const };
}

function rates(): AggregateSourceScorecard["scorecards"][number]["rates"] {
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
			state: "not_applicable" as const,
			metric: "copyedit_preservation" as const,
			unit: "ratio" as const,
			denominator_unit: "parse_success_copyedit_output" as const,
			scorecard_context: unknownContext(),
			reason: "role_not_applicable" as const,
			numerator: 0 as const,
			denominator: 0 as const,
			sample_count: 0 as const,
			interval: { state: "not_applicable" as const },
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
		{
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
		},
	];
}

function distributions() {
	return [
		{ metric: "input_tokens" as const, unit: "tokens" as const, scorecard_context: unknownContext(), sample_count: 0, observed_sample_count: 0, unavailable_sample_count: 0, samples: [], summary: { state: "unavailable" as const } },
		{ metric: "output_tokens" as const, unit: "tokens" as const, scorecard_context: unknownContext(), sample_count: 0, observed_sample_count: 0, unavailable_sample_count: 0, samples: [], summary: { state: "unavailable" as const } },
		{ metric: "total_tokens" as const, unit: "tokens" as const, scorecard_context: unknownContext(), sample_count: 0, observed_sample_count: 0, unavailable_sample_count: 0, samples: [], summary: { state: "unavailable" as const } },
		{ metric: "application_latency_ms" as const, unit: "milliseconds" as const, scorecard_context: unknownContext(), sample_count: 0, observed_sample_count: 0, unavailable_sample_count: 0, samples: [], summary: { state: "unavailable" as const } },
		{ metric: "provider_time_to_first_token_ms" as const, unit: "milliseconds" as const, scorecard_context: unknownContext(), sample_count: 0, observed_sample_count: 0, unavailable_sample_count: 0, samples: [], summary: { state: "unavailable" as const } },
		{ metric: "provider_total_time_ms" as const, unit: "milliseconds" as const, scorecard_context: unknownContext(), sample_count: 0, observed_sample_count: 0, unavailable_sample_count: 0, samples: [], summary: { state: "unavailable" as const } },
	];
}

function qualitative() {
	return [
		{ criterion: "coherence" as const, unit: "review_assessment" as const, sample_unit: "codex_reviewed_output" as const, scorecard_context: unknownContext(), sample_count: 0, counts: { meets: 0, partly_meets: 0, does_not_meet: 0, uncertain: 0 }, evidence: [] },
		{ criterion: "usefulness" as const, unit: "review_assessment" as const, sample_unit: "codex_reviewed_output" as const, scorecard_context: unknownContext(), sample_count: 0, counts: { meets: 0, partly_meets: 0, does_not_meet: 0, uncertain: 0 }, evidence: [] },
		{ criterion: "newsworthiness" as const, unit: "review_assessment" as const, sample_unit: "codex_reviewed_output" as const, scorecard_context: unknownContext(), sample_count: 0, counts: { meets: 0, partly_meets: 0, does_not_meet: 0, uncertain: 0 }, evidence: [] },
		{ criterion: "voice" as const, unit: "review_assessment" as const, sample_unit: "codex_reviewed_output" as const, scorecard_context: unknownContext(), sample_count: 0, counts: { meets: 0, partly_meets: 0, does_not_meet: 0, uncertain: 0 }, evidence: [] },
	];
}

function scorecard(
	step: AggregateSourceScorecard["scorecards"][number]["production_step"],
): AggregateSourceScorecard["scorecards"][number] {
	return {
		production_step: step,
		adapter: PRODUCTION_STEPS[step],
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
		rates: rates(),
		distributions: distributions(),
		qualitative: qualitative(),
	};
}

function aggregateSource(sourceSha256: string = HASH): AggregateSourceScorecard {
	return {
		version: 3,
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
				exact_config: { production_steps: PRODUCTION_STEPS },
			},
			repetition_count: 1,
			sources: {
				benchmark_runs: [{
					ordinal: 1,
					corpus_fixture_id: "fixture-one",
					benchmark_run_id: "benchmark-one",
					source_reference: sourceReference("runs/benchmark-one.json"),
					code_commit_sha: "4".repeat(40),
					prepared_evidence_identity_sha256: HASH,
					output_contract_sha256s: [HASH, HASH, HASH, HASH],
					transport_retry_limit: 0,
				}],
				annotations: {
					source_reference: sourceReference("codex/annotations.json"),
					bundle_id: "annotations-one",
					protocol_id: "bc-news-output-annotation",
				annotator_id: "codex",
				annotator_kind: "codex",
				annotated_at: "2026-08-17T11:00:00.000Z",
				},
				qualitative_reviews: {
					source_reference: sourceReference("codex/reviews.json"),
					bundle_id: "reviews-one",
					rubric_id: "bc-news-editorial-qualitative",
				reviewer_id: "codex",
				reviewer_kind: "codex",
				reviewed_at: "2026-08-17T11:05:00.000Z",
			},
		},
		scorecards: [
			scorecard("main_story_write"),
			scorecard("main_story_copyedit"),
			scorecard("announcements_write"),
			scorecard("announcements_copyedit"),
		],
	};
}

test("builds a strict v2 aggregate projection with a bound cohort witness", () => {
	const aggregate = buildEvaluationAggregateResult(aggregateSource(), {
		id: "aggregate-one",
		createdAt: "2026-08-17T12:30:00.000Z",
		cohortId: "corpus-one",
		rawMessageCount: 385,
		preparedMessageCount: 149,
	});
	const [mainStoryWrite, mainStoryCopyedit, announcementsWrite, announcementsCopyedit] = aggregate.roles;

	expect(EvaluationAggregateResultSchema.safeParse(aggregate).success).toBe(true);
	expect(AnyEvaluationAggregateResultSchema.safeParse(aggregate).success).toBe(true);
	expect(aggregate).toMatchObject({
		version: 2,
		id: "aggregate-one",
		evidence_retention: "local_only",
		source_scorecard: { version: 3, id: "scorecard-one" },
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
		"main_story_copyedit",
		"announcements_write",
		"announcements_copyedit",
	]);
	expect(mainStoryCopyedit.subject).toEqual({
		adapter: "lmstudio",
		model: "lmstudio-model",
		temperature: 0.4,
		reasoning_effort: "provider_default",
	});
	expect(announcementsWrite.subject).toEqual({
		adapter: "openai_compatible_hosted",
		provider: "openai",
		model: "gpt-hosted",
		temperature: 0.2,
	});
	expect(announcementsCopyedit.subject).toEqual({
		adapter: "cloudflare_ai_gateway",
		model: "@cf/meta/llama",
		temperature: 0.1,
	});
	expect(announcementsCopyedit.subject).not.toHaveProperty("gateway");
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

test("rejects old scorecard sources for current aggregate builds", () => {
	expect(() => buildEvaluationAggregateResult(
		{
			...aggregateSource(),
			version: 2,
			corpus: { id: "corpus-one", fixture_count: 6 },
		} as unknown as EvaluationScorecardArtifact,
		{ id: "aggregate-one", createdAt: "2026-08-17T12:30:00.000Z", cohortId: "corpus-one" },
	)).toThrowError(EvaluationAggregateResultError);
	try {
		buildEvaluationAggregateResult(
			{
				...aggregateSource(),
				version: 2,
				corpus: { id: "corpus-one", fixture_count: 6 },
			} as unknown as EvaluationScorecardArtifact,
			{ id: "aggregate-one", createdAt: "2026-08-17T12:30:00.000Z", cohortId: "corpus-one" },
		);
	} catch (error) {
		expect(error).toBeInstanceOf(EvaluationAggregateResultError);
		expect((error as EvaluationAggregateResultError).code).toBe("unsupported_source_scorecard_version");
	}
});

test("surfaces digest drift when two private corpora share the same id and counts", () => {
	const left = buildEvaluationAggregateResult(aggregateSource(HASH), {
		id: "aggregate-left",
		createdAt: "2026-08-17T12:30:00.000Z",
		cohortId: "corpus-one",
	});
	const rightSource = aggregateSource(ALT_HASH);
	const right = buildEvaluationAggregateResult(rightSource, {
		id: "aggregate-right",
		createdAt: "2026-08-17T12:35:00.000Z",
		cohortId: "corpus-one",
	});

	const report = formatEvaluationAggregateResultReport(left);
	expect(report).toContain("Evaluation aggregate result v2: aggregate-left");
	expect(report).toContain(`evidence_identity_sha256=${HASH}`);
	expect(report).toContain("Evidence retention: local_only");
	expect(report).toContain("Role: announcements_copyedit");
	expect(report).not.toContain("source_reference");
	expect(report).not.toContain("gateway_request_sha256");
	expect(report).not.toContain("pricing_reference");
	expect(report).not.toContain("rationale");

	const comparison = compareEvaluationAggregateResults(left, right);
	expect(comparison.differences).toContain("aggregate.cohort.evidence_identity_sha256");
	const comparisonText = formatEvaluationAggregateResultComparison(comparison);
	expect(comparisonText).toContain("Aggregate differences:");
	expect(comparisonText).toContain("aggregate.cohort.evidence_identity_sha256");
	expect(comparisonText).not.toMatch(/winner|better|worse|accept|reject|rank/iu);
});
