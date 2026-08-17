import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { runEvalCliApplication } from "../src/cli";
import {
	createEvaluationAggregateResultArtifact,
	loadEvaluationAggregateResultArtifact,
} from "../src/evaluation-aggregate-result-store";
import { EvaluationAggregateResultSchema } from "../src/evaluation-aggregate-result";
import { buildEvaluationAggregateResult } from "../src/evaluation-aggregate-result-builder";
import { buildEvaluationScorecard } from "../src/evaluation-scorecard-builder";
import { loadEvaluationScorecardInput } from "../src/evaluation-scorecard-input";
import { createEvaluationScorecardArtifact } from "../src/evaluation-scorecard-store";
import {
	buildControlledEvaluationScorecardInput,
	initializeControlledEvaluationRepository,
} from "../src/evaluation-scorecard-verifier";

function aggregateArtifact(id: string) {
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
	return EvaluationAggregateResultSchema.parse({
		version: 1,
		id,
		created_at: "2026-08-17T13:00:00.000Z",
		evidence_retention: "local_only",
		source_scorecard: {
			version: 2,
			id: "scorecard-one",
			created_at: "2026-08-17T12:00:00.000Z",
		},
		cohort: {
			id: "cohort-one",
			fixture_count: 6,
			repetition_count: 1,
		},
		configuration_identity: "config-one",
		roles: [
			{
				production_step: "main_story_write",
				subject: { adapter: "recorded" },
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
					{ ...rate, metric: "schema_reliability", denominator_unit: "terminal_provider_success_invocation" },
					{ state: "not_applicable" as const, metric: "copyedit_preservation", unit: "ratio" as const, denominator_unit: "parse_success_copyedit_output" as const, reason: "role_not_applicable" as const, numerator: 0, denominator: 0, sample_count: 0, interval: { state: "not_applicable" as const } },
					{ ...rate, metric: "claim_grounding", denominator_unit: "codex_annotated_factual_claim" },
					{ ...rate, metric: "required_attribution", denominator_unit: "codex_annotated_required_attribution_claim" },
					{ ...rate, metric: "event_coverage", denominator_unit: "source_event_output_pair" },
					{ ...rate, metric: "announcement_relevance", denominator_unit: "parsed_announcement" },
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
			},
			{
				production_step: "main_story_copyedit",
				subject: { adapter: "lmstudio", model: "lmstudio-model", reasoning_effort: "provider_default" },
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
					{ ...rate, metric: "schema_reliability", denominator_unit: "terminal_provider_success_invocation" },
					{ ...rate, metric: "copyedit_preservation", denominator_unit: "parse_success_copyedit_output" },
					{ ...rate, metric: "claim_grounding", denominator_unit: "codex_annotated_factual_claim" },
					{ ...rate, metric: "required_attribution", denominator_unit: "codex_annotated_required_attribution_claim" },
					{ ...rate, metric: "event_coverage", denominator_unit: "source_event_output_pair" },
					{ ...rate, metric: "announcement_relevance", denominator_unit: "parsed_announcement" },
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
			},
			{
				production_step: "announcements_write",
				subject: { adapter: "openai_compatible_hosted", provider: "openai", model: "gpt-hosted" },
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
					{ ...rate, metric: "schema_reliability", denominator_unit: "terminal_provider_success_invocation" },
					{ state: "not_applicable" as const, metric: "copyedit_preservation", unit: "ratio" as const, denominator_unit: "parse_success_copyedit_output" as const, reason: "role_not_applicable" as const, numerator: 0, denominator: 0, sample_count: 0, interval: { state: "not_applicable" as const } },
					{ ...rate, metric: "claim_grounding", denominator_unit: "codex_annotated_factual_claim" },
					{ ...rate, metric: "required_attribution", denominator_unit: "codex_annotated_required_attribution_claim" },
					{ ...rate, metric: "event_coverage", denominator_unit: "source_event_output_pair" },
					{ ...rate, metric: "announcement_relevance", denominator_unit: "parsed_announcement" },
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
			},
			{
				production_step: "announcements_copyedit",
				subject: { adapter: "cloudflare_ai_gateway", model: "@cf/meta/llama" },
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
					{ ...rate, metric: "schema_reliability", denominator_unit: "terminal_provider_success_invocation" },
					{ ...rate, metric: "copyedit_preservation", denominator_unit: "parse_success_copyedit_output" },
					{ ...rate, metric: "claim_grounding", denominator_unit: "codex_annotated_factual_claim" },
					{ ...rate, metric: "required_attribution", denominator_unit: "codex_annotated_required_attribution_claim" },
					{ ...rate, metric: "event_coverage", denominator_unit: "source_event_output_pair" },
					{ ...rate, metric: "announcement_relevance", denominator_unit: "parsed_announcement" },
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
			},
		],
	});
}

async function invokeCli(
	argv: readonly string[],
	currentDirectory: string,
	appDirectory: string,
): Promise<string> {
	let output = "";
	await runEvalCliApplication({
		argv,
		currentDirectory,
		appDirectory,
		environment: { INIT_CWD: currentDirectory },
		writeOutput: (text) => {
			output += text;
		},
	});
	return output;
}

test("stores aggregate artifacts strictly and enforces filename identity", async () => {
	const resultsDirectory = await mkdtemp(join(tmpdir(), "bc-news-aggregate-store-"));
	try {
		const artifact = aggregateArtifact("aggregate-one");
		expect(await createEvaluationAggregateResultArtifact(artifact, resultsDirectory)).toBe(
			join(resultsDirectory, "aggregate-one.json"),
		);
		await expect(createEvaluationAggregateResultArtifact(artifact, resultsDirectory)).rejects.toThrow(
			"Could not exclusively create aggregate result artifact",
		);
		expect(await loadEvaluationAggregateResultArtifact("aggregate-one", resultsDirectory)).toEqual(artifact);
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

test("routes aggregate export show and compare through the application", async () => {
	const root = await mkdtemp(join(tmpdir(), "bc-news-aggregate-app-"));
	try {
		const repositoryRoot = join(root, "repository");
		const appDirectory = join(root, "app");
		await mkdir(appDirectory, { recursive: true });
		const corpusSource = resolve(
			dirname(fileURLToPath(import.meta.url)),
			"../../../packages/fixtures/evaluation-corpus",
		);
		const { manifestPath, codeCommit } = await initializeControlledEvaluationRepository(repositoryRoot, corpusSource);
		const controlled = await buildControlledEvaluationScorecardInput(repositoryRoot, manifestPath, { codeCommit });
		const input = await loadEvaluationScorecardInput(controlled.declarationPath, repositoryRoot);
		const scorecard = buildEvaluationScorecard(input, {
			id: "controlled-scorecard",
			createdAt: controlled.createdAt,
		});
		const scorecardDirectory = join(repositoryRoot, "scorecards");
		await mkdir(scorecardDirectory, { recursive: true });
		const scorecardPath = join(scorecardDirectory, `${scorecard.id}.json`);
		await createEvaluationScorecardArtifact(scorecardPath, scorecard, repositoryRoot);
		const aggregateInputPath = relative(repositoryRoot, scorecardPath);
		const exportOne = await invokeCli(
			["aggregate", "export", "--input", aggregateInputPath, "--cohort", scorecard.corpus.id],
			repositoryRoot,
			appDirectory,
		);
		const aggregateOneId = exportOne.match(/Evaluation aggregate result v1: ([^\n]+)/u)?.[1];
		expect(aggregateOneId).toBeDefined();
		expect(exportOne).toContain(`Cohort: id=${scorecard.corpus.id}`);
		expect(exportOne).not.toContain("supporting_witnesses");
		expect(exportOne).not.toContain("source_reference");
		await expect(
			invokeCli(
				["aggregate", "export", "--input", aggregateInputPath, "--cohort", "baseline-b"],
				repositoryRoot,
				appDirectory,
			),
		).rejects.toThrow("Aggregate cohort id must match source scorecard corpus id");
		const aggregateTwo = buildEvaluationAggregateResult(scorecard, {
			id: "aggregate-two",
			createdAt: new Date(Date.parse(scorecard.created_at) + 1_000).toISOString(),
			cohortId: scorecard.corpus.id,
			rawMessageCount: 7,
		});
		const summariesDirectory = join(appDirectory, "summaries");
		await createEvaluationAggregateResultArtifact(aggregateTwo, summariesDirectory);
		expect((await readdir(summariesDirectory)).filter((name) => name.endsWith(".json")).length).toBe(2);
		const aggregateOne = await loadEvaluationAggregateResultArtifact(aggregateOneId!, summariesDirectory);
		expect(aggregateOne.cohort.id).toBe(scorecard.corpus.id);
		const showOutput = await invokeCli(
			["aggregate", "show", aggregateOneId!],
			repositoryRoot,
			appDirectory,
		);
		expect(showOutput).toContain(`Evaluation aggregate result v1: ${aggregateOneId!}`);
		expect(showOutput).toContain("Evidence retention: local_only");
		expect(showOutput).not.toContain("gateway_request_sha256");
		const compareOutput = await invokeCli(
			["aggregate", "compare", aggregateOneId!, aggregateTwo.id],
			repositoryRoot,
			appDirectory,
		);
		expect(compareOutput).toContain(`Left aggregate result: ${aggregateOneId!}`);
		expect(compareOutput).toContain(`Right aggregate result: ${aggregateTwo.id}`);
		expect(compareOutput).toContain("- aggregate.cohort.raw_message_count");
		expect(compareOutput).not.toContain("qualitative_reviews");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}, 90_000);
