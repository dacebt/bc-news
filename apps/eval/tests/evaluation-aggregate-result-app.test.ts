import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { buildEvaluationAggregateResult } from "../src/evaluation-aggregate-result-builder";
import { compareEvaluationAggregateResults } from "../src/evaluation-aggregate-result-comparison";
import {
	createEvaluationAggregateResultArtifact,
	loadEvaluationAggregateResultArtifact,
} from "../src/evaluation-aggregate-result-store";
import {
	EvaluationAggregateResultSchema,
	EvaluationAggregateResultV1Schema,
} from "../src/evaluation-aggregate-result";
import { formatEvaluationAggregateResultReport } from "../src/evaluation-aggregate-result-report";
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

function scorecard(
	step: AggregateSourceScorecard["scorecards"][number]["production_step"],
): AggregateSourceScorecard["scorecards"][number] {
	const rate = {
		state: "measured" as const,
		unit: "ratio" as const,
		numerator: 3,
		denominator: 4,
		sample_count: 4,
		value: 0.75,
		interval: {
			confidence: 0.95 as const,
			method: "wilson_score" as const,
			lower: 0.3,
			upper: 0.95,
		},
	};
	const unavailableDistribution = {
		sample_count: 0,
		observed_sample_count: 0,
		unavailable_sample_count: 0,
		summary: { state: "unavailable" as const },
	};
	const qualitativeCounts = {
		sample_count: 2,
		counts: { meets: 1, partly_meets: 1, does_not_meet: 0, uncertain: 0 },
	};
	return {
		production_step: step,
		adapter: PRODUCTION_STEPS[step],
		scorecard_context: unknownContext(),
		sample_counts: {
			declared_trial_count: 4,
			step_reached_trial_count: 4,
			step_not_reached_trial_count: 0,
			invocation_attempt_count: 4,
			initial_attempt_count: 4,
			retry_attempt_count: 0,
			transport_failed_attempt_count: 0,
			transport_succeeded_attempt_count: 4,
			parse_succeeded_invocation_count: 4,
			parse_rejected_invocation_count: 0,
			annotated_output_count: 4,
			reviewed_output_count: 4,
		},
		rates: [
			{ ...rate, metric: "schema_reliability", denominator_unit: "terminal_provider_success_invocation", scorecard_context: unknownContext() },
			{ state: "not_applicable" as const, metric: "copyedit_preservation", unit: "ratio" as const, denominator_unit: "parse_success_copyedit_output" as const, reason: "role_not_applicable" as const, numerator: 0 as const, denominator: 0 as const, sample_count: 0 as const, interval: { state: "not_applicable" as const }, scorecard_context: unknownContext() },
			{ ...rate, metric: "claim_grounding", denominator_unit: "codex_annotated_factual_claim", scorecard_context: unknownContext() },
			{ ...rate, metric: "required_attribution", denominator_unit: "codex_annotated_required_attribution_claim", scorecard_context: unknownContext() },
			{ ...rate, metric: "event_coverage", denominator_unit: "source_event_output_pair", scorecard_context: unknownContext() },
			{ ...rate, metric: "announcement_relevance", denominator_unit: "parsed_announcement", scorecard_context: unknownContext() },
		],
		distributions: [
			{ metric: "input_tokens", unit: "tokens", ...unavailableDistribution, scorecard_context: unknownContext(), samples: [] },
			{ metric: "output_tokens", unit: "tokens", ...unavailableDistribution, scorecard_context: unknownContext(), samples: [] },
			{ metric: "total_tokens", unit: "tokens", ...unavailableDistribution, scorecard_context: unknownContext(), samples: [] },
			{ metric: "application_latency_ms", unit: "milliseconds", ...unavailableDistribution, scorecard_context: unknownContext(), samples: [] },
			{ metric: "provider_time_to_first_token_ms", unit: "milliseconds", ...unavailableDistribution, scorecard_context: unknownContext(), samples: [] },
			{ metric: "provider_total_time_ms", unit: "milliseconds", ...unavailableDistribution, scorecard_context: unknownContext(), samples: [] },
		],
		qualitative: [
			{ criterion: "coherence", unit: "review_assessment", sample_unit: "codex_reviewed_output", ...qualitativeCounts, scorecard_context: unknownContext(), evidence: [] },
			{ criterion: "usefulness", unit: "review_assessment", sample_unit: "codex_reviewed_output", ...qualitativeCounts, scorecard_context: unknownContext(), evidence: [] },
			{ criterion: "newsworthiness", unit: "review_assessment", sample_unit: "codex_reviewed_output", ...qualitativeCounts, scorecard_context: unknownContext(), evidence: [] },
			{ criterion: "voice", unit: "review_assessment", sample_unit: "codex_reviewed_output", ...qualitativeCounts, scorecard_context: unknownContext(), evidence: [] },
		],
	};
}

function aggregateSource(sourceSha256: string = HASH): AggregateSourceScorecard {
	return {
		version: 3,
		id: "scorecard-one",
		created_at: "2026-08-17T12:00:00.000Z",
		source_reference: sourceReference("scorecards/scorecard-one.json"),
		corpus: {
			id: "cohort-one",
			fixture_count: 6,
			source_reference: sourceReference("corpus/manifest.json", sourceSha256),
		},
		configuration: { identity: "config-one", exact_config: { production_steps: PRODUCTION_STEPS } },
		repetition_count: 1,
		sources: {
			benchmark_runs: [],
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

function aggregateArtifact(id: string) {
	return buildEvaluationAggregateResult(aggregateSource(), {
		id,
		createdAt: "2026-08-17T13:00:00.000Z",
		cohortId: "cohort-one",
	});
}

function historicalAggregateArtifact(id: string) {
	return EvaluationAggregateResultV1Schema.parse({
		version: 1,
		id,
		created_at: "2026-08-17T11:00:00.000Z",
		evidence_retention: "local_only",
		source_scorecard: {
			version: 2,
			id: "historical-scorecard",
			created_at: "2026-08-17T10:00:00.000Z",
		},
		cohort: {
			id: "cohort-one",
			fixture_count: 6,
			repetition_count: 1,
		},
		configuration_identity: "config-one",
		roles: aggregateArtifact("current-projection").roles,
	});
}

test("stores current v2 aggregate artifacts strictly and enforces filename identity", async () => {
	const resultsDirectory = await mkdtemp(join(tmpdir(), "bc-news-aggregate-store-"));
	try {
		const artifact = aggregateArtifact("aggregate-one");
		expect(EvaluationAggregateResultSchema.safeParse(artifact).success).toBe(true);
		expect(await createEvaluationAggregateResultArtifact(artifact, resultsDirectory)).toBe(
			join(resultsDirectory, "aggregate-one.json"),
		);
		await expect(createEvaluationAggregateResultArtifact(artifact, resultsDirectory)).rejects.toThrow(
			"Could not exclusively create aggregate result artifact",
		);
		expect(await loadEvaluationAggregateResultArtifact("aggregate-one", resultsDirectory)).toEqual(artifact);
		const storedJson = await readFile(join(resultsDirectory, "aggregate-one.json"), "utf8");
		expect(storedJson).toContain(`"evidence_identity_sha256": "${HASH}"`);
		for (const forbidden of ["\"source_reference\"", "\"supporting_witnesses\"", "\"gateway_request_sha256\"", "\"pricing_reference\"", "\"rationale\"", "\"scorecard_context\"", "\"samples\"", "\"evidence\":", "\"gateway\":", "\"billing\":", "\"annotator_id\"", "\"reviewer_id\""]) {
			expect(storedJson).not.toContain(forbidden);
		}
		await writeFile(
			join(resultsDirectory, "aggregate-mismatch.json"),
			`${JSON.stringify({ ...artifact, id: "aggregate-other" }, null, 2)}\n`,
			"utf8",
		);
		await expect(
			loadEvaluationAggregateResultArtifact("aggregate-mismatch", resultsDirectory),
		).rejects.toThrow("Aggregate result filename identity mismatch");
		await writeFile(
			join(resultsDirectory, "aggregate-injected.json"),
			`${JSON.stringify({ ...artifact, id: "aggregate-injected", forbidden_payload: true }, null, 2)}\n`,
			"utf8",
		);
		await expect(
			loadEvaluationAggregateResultArtifact("aggregate-injected", resultsDirectory),
		).rejects.toThrow("Aggregate result contract rejected");
	} finally {
		await rm(resultsDirectory, { recursive: true, force: true });
	}
});

test("reopens historical v1 aggregates unchanged while current comparisons expose digest drift", async () => {
	const resultsDirectory = await mkdtemp(join(tmpdir(), "bc-news-aggregate-history-"));
	try {
		const historical = historicalAggregateArtifact("aggregate-v1");
		await writeFile(join(resultsDirectory, "aggregate-v1.json"), `${JSON.stringify(historical, null, 2)}\n`, "utf8");
		const reopenedHistorical = await loadEvaluationAggregateResultArtifact("aggregate-v1", resultsDirectory);
		expect(reopenedHistorical).toEqual(historical);
		expect(formatEvaluationAggregateResultReport(reopenedHistorical)).toContain("Evaluation aggregate result v1: aggregate-v1");

		const left = aggregateArtifact("aggregate-left");
		const right = buildEvaluationAggregateResult(aggregateSource(ALT_HASH), {
			id: "aggregate-right",
			createdAt: "2026-08-17T13:01:00.000Z",
			cohortId: "cohort-one",
		});
		await createEvaluationAggregateResultArtifact(left, resultsDirectory);
		await createEvaluationAggregateResultArtifact(right, resultsDirectory);

		const comparison = compareEvaluationAggregateResults(
			await loadEvaluationAggregateResultArtifact("aggregate-left", resultsDirectory),
			await loadEvaluationAggregateResultArtifact("aggregate-right", resultsDirectory),
		);
		expect(comparison.differences).toContain("aggregate.cohort.evidence_identity_sha256");
	} finally {
		await rm(resultsDirectory, { recursive: true, force: true });
	}
});
