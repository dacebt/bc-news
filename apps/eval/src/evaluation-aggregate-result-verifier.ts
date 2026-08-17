import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildEvaluationAggregateResult } from "./evaluation-aggregate-result-builder";
import {
	compareEvaluationAggregateResults,
	formatEvaluationAggregateResultComparison,
} from "./evaluation-aggregate-result-comparison";
import { formatEvaluationAggregateResultReport } from "./evaluation-aggregate-result-report";
import {
	EvaluationAggregateResultV1Schema,
	type EvaluationAggregateResult,
} from "./evaluation-aggregate-result";
import {
	createEvaluationAggregateResultArtifact,
	loadEvaluationAggregateResultArtifact,
} from "./evaluation-aggregate-result-store";
import type { EvaluationScorecardArtifact } from "./evaluation-scorecard";

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

function assertProof(condition: boolean, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function json(value: object): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

function sourceReference(path: string, sha256: string = HASH) {
	return { path, sha256 } as const;
}

function unknownContext() {
	return { state: "unknown" as const, reason: "no_captured_invocation" as const };
}

function scorecard(
	step: AggregateSourceScorecard["scorecards"][number]["production_step"],
): AggregateSourceScorecard["scorecards"][number] {
	const measuredRate = {
		state: "measured" as const,
		unit: "ratio" as const,
		numerator: 3,
		denominator: 4,
		sample_count: 4,
		value: 0.75,
		interval: { confidence: 0.95 as const, method: "wilson_score" as const, lower: 0.3, upper: 0.95 },
		scorecard_context: unknownContext(),
	};
	const unavailableDistribution = {
		sample_count: 0,
		observed_sample_count: 0,
		unavailable_sample_count: 0,
		summary: { state: "unavailable" as const },
		scorecard_context: unknownContext(),
		samples: [],
	};
	const qualitativeCounts = {
		sample_count: 2,
		counts: { meets: 1, partly_meets: 1, does_not_meet: 0, uncertain: 0 },
		scorecard_context: unknownContext(),
		evidence: [],
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
			{ ...measuredRate, metric: "schema_reliability", denominator_unit: "terminal_provider_success_invocation" },
			{ state: "not_applicable" as const, metric: "copyedit_preservation", unit: "ratio" as const, denominator_unit: "parse_success_copyedit_output" as const, reason: "role_not_applicable" as const, numerator: 0 as const, denominator: 0 as const, sample_count: 0 as const, interval: { state: "not_applicable" as const }, scorecard_context: unknownContext() },
			{ ...measuredRate, metric: "claim_grounding", denominator_unit: "codex_annotated_factual_claim" },
			{ ...measuredRate, metric: "required_attribution", denominator_unit: "codex_annotated_required_attribution_claim" },
			{ ...measuredRate, metric: "event_coverage", denominator_unit: "source_event_output_pair" },
			{ ...measuredRate, metric: "announcement_relevance", denominator_unit: "parsed_announcement" },
		],
		distributions: [
			{ metric: "input_tokens", unit: "tokens", ...unavailableDistribution },
			{ metric: "output_tokens", unit: "tokens", ...unavailableDistribution },
			{ metric: "total_tokens", unit: "tokens", ...unavailableDistribution },
			{ metric: "application_latency_ms", unit: "milliseconds", ...unavailableDistribution },
			{ metric: "provider_time_to_first_token_ms", unit: "milliseconds", ...unavailableDistribution },
			{ metric: "provider_total_time_ms", unit: "milliseconds", ...unavailableDistribution },
		],
		qualitative: [
			{ criterion: "coherence", unit: "review_assessment", sample_unit: "codex_reviewed_output", ...qualitativeCounts },
			{ criterion: "usefulness", unit: "review_assessment", sample_unit: "codex_reviewed_output", ...qualitativeCounts },
			{ criterion: "newsworthiness", unit: "review_assessment", sample_unit: "codex_reviewed_output", ...qualitativeCounts },
			{ criterion: "voice", unit: "review_assessment", sample_unit: "codex_reviewed_output", ...qualitativeCounts },
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

function historicalAggregate(roles: EvaluationAggregateResult["roles"]) {
	return EvaluationAggregateResultV1Schema.parse({
		version: 1,
		id: "aggregate-v1",
		created_at: "2026-08-17T11:30:00.000Z",
		evidence_retention: "local_only",
		source_scorecard: {
			version: 2,
			id: "historical-scorecard",
			created_at: "2026-08-17T10:30:00.000Z",
		},
		cohort: {
			id: "cohort-one",
			fixture_count: 6,
			repetition_count: 1,
		},
		configuration_identity: "config-one",
		roles,
	});
}

export async function verifyEvaluationAggregateResults(temporaryRoot?: string): Promise<string> {
	const root = temporaryRoot ?? await mkdtemp(join(tmpdir(), "bc-news-evaluation-aggregate-results-"));
	const cleanup = temporaryRoot === undefined;
	try {
		const resultsDirectory = join(root, "summaries");
		await mkdir(resultsDirectory, { recursive: true });

		const aggregateOne = buildEvaluationAggregateResult(aggregateSource(HASH), {
			id: "aggregate-one",
			createdAt: "2026-08-17T13:00:00.000Z",
			cohortId: "cohort-one",
			rawMessageCount: 7,
		});
		const aggregateTwo = buildEvaluationAggregateResult(aggregateSource(ALT_HASH), {
			id: "aggregate-two",
			createdAt: "2026-08-17T13:01:00.000Z",
			cohortId: "cohort-one",
			rawMessageCount: 7,
		});

		await createEvaluationAggregateResultArtifact(aggregateOne, resultsDirectory);
		await createEvaluationAggregateResultArtifact(aggregateTwo, resultsDirectory);
		await writeFile(join(resultsDirectory, "aggregate-v1.json"), json(historicalAggregate(aggregateOne.roles)), "utf8");

		const reopenedOne = await loadEvaluationAggregateResultArtifact("aggregate-one", resultsDirectory);
		const reopenedHistorical = await loadEvaluationAggregateResultArtifact("aggregate-v1", resultsDirectory);
		assertProof(reopenedOne.version === 2, "Current aggregate did not reopen as version 2");
		assertProof(reopenedHistorical.version === 1, "Historical aggregate did not reopen as version 1");
		assertProof(reopenedOne.cohort.evidence_identity_sha256 === HASH, "Current aggregate did not retain the bound cohort witness");

		const storedJson = await readFile(join(resultsDirectory, "aggregate-one.json"), "utf8");
		assertProof(storedJson.includes(`"evidence_identity_sha256": "${HASH}"`), "Aggregate artifact omitted the cohort witness digest");
		for (const forbidden of ["\"source_reference\"", "\"supporting_witnesses\"", "\"annotation_id\"", "\"review_id\"", "\"gateway_request_sha256\"", "\"pricing_reference\"", "\"rationale\"", "\"scorecard_context\"", "\"samples\"", "\"evidence\":", "\"gateway\":", "\"billing\":", "\"annotator_id\"", "\"reviewer_id\""]) {
			assertProof(!storedJson.includes(forbidden), `Aggregate artifact retained forbidden field ${forbidden}`);
		}

		const report = formatEvaluationAggregateResultReport(reopenedOne);
		assertProof(report.includes("Evaluation aggregate result v2: aggregate-one"), "Aggregate report did not render the current aggregate");
		assertProof(report.includes(`evidence_identity_sha256=${HASH}`), "Aggregate report omitted the cohort witness digest");
		assertProof(formatEvaluationAggregateResultReport(reopenedHistorical).includes("Evaluation aggregate result v1: aggregate-v1"), "Historical aggregate report did not render the frozen artifact");

		const comparison = compareEvaluationAggregateResults(
			reopenedOne,
			await loadEvaluationAggregateResultArtifact("aggregate-two", resultsDirectory),
		);
		assertProof(comparison.differences.includes("aggregate.cohort.evidence_identity_sha256"), "Aggregate comparison did not report digest drift");
		assertProof(formatEvaluationAggregateResultComparison(comparison).includes("aggregate.cohort.evidence_identity_sha256"), "Aggregate comparison text did not name digest drift");

		let oldSourceRejected = false;
		try {
			buildEvaluationAggregateResult(
				{
					...aggregateSource(),
					version: 2,
					corpus: { id: "cohort-one", fixture_count: 6 },
				} as unknown as EvaluationScorecardArtifact,
				{ id: "aggregate-old", createdAt: "2026-08-17T13:05:00.000Z", cohortId: "cohort-one" },
			);
		} catch (error) {
			oldSourceRejected = error instanceof Error
				&& error.message.includes("supports Evaluation Scorecard version 3 only");
		}
		assertProof(oldSourceRejected, "Aggregate build accepted an old scorecard source");

		await expectExclusiveCreate(reopenedOne, resultsDirectory);
		await expectFilenameMismatch(reopenedOne, resultsDirectory);
		await expectStrictForbiddenInjection(reopenedOne, resultsDirectory);

		return `${report}\nEVALUATION AGGREGATE RESULTS VERIFIED`;
	} finally {
		if (cleanup) await rm(root, { recursive: true, force: true });
	}
}

async function expectExclusiveCreate(
	aggregate: EvaluationAggregateResult,
	resultsDirectory: string,
): Promise<void> {
	let rejected = false;
	try {
		await createEvaluationAggregateResultArtifact(aggregate, resultsDirectory);
	} catch {
		rejected = true;
	}
	assertProof(rejected, "Aggregate store accepted a duplicate exclusive create");
}

async function expectFilenameMismatch(
	aggregate: EvaluationAggregateResult,
	resultsDirectory: string,
): Promise<void> {
	await writeFile(
		join(resultsDirectory, "aggregate-mismatch.json"),
		json({ ...aggregate, id: "aggregate-other" }),
		"utf8",
	);
	let rejected = false;
	try {
		await loadEvaluationAggregateResultArtifact("aggregate-mismatch", resultsDirectory);
	} catch {
		rejected = true;
	}
	assertProof(rejected, "Aggregate store accepted a filename/id mismatch");
}

async function expectStrictForbiddenInjection(
	aggregate: EvaluationAggregateResult,
	resultsDirectory: string,
): Promise<void> {
	await writeFile(
		join(resultsDirectory, "aggregate-injected.json"),
		json({ ...aggregate, id: "aggregate-injected", source_reference: { path: "forbidden" } }),
		"utf8",
	);
	let rejected = false;
	try {
		await loadEvaluationAggregateResultArtifact("aggregate-injected", resultsDirectory);
	} catch {
		rejected = true;
	}
	assertProof(rejected, "Aggregate store accepted strict forbidden-field injection");
}

async function main(): Promise<void> {
	process.stdout.write(`${await verifyEvaluationAggregateResults()}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	void main();
}
