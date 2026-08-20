import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { BenchmarkRunSchema, type BenchmarkRun } from "../src/evaluation-artifact";
import { verifyEvaluationBenchmarkBrowsing } from "../src/evaluation-browse-verifier";
import { summarizeBenchmarkRun } from "../src/evaluation-browse-report";
import { listBenchmarkRuns, loadBenchmarkRun } from "../src/evaluation-artifact-reader";
import { compareBenchmarkRuns } from "../src/evaluation-comparison";
import { runEvalCliApplication } from "../src/cli";
import {
	controlledEvaluation,
	finalProductRejectedWriterOutput,
	temporaryRoot,
} from "./evaluation-artifact-test-support";

function withArtifactIdentity(run: BenchmarkRun, id: string, startedAt: string) {
	return BenchmarkRunSchema.parse({
		...structuredClone(run),
		id,
		started_at: startedAt,
	});
}

async function invokeCli(argv: readonly string[], currentDirectory: string, appDirectory: string): Promise<string> {
	let output = "";
	await runEvalCliApplication({
		argv,
		currentDirectory,
		appDirectory,
		environment: { INIT_CWD: currentDirectory },
		writeOutput: (text) => { output += text; },
	});
	return output;
}

test("browses retained benchmark evidence through the CLI boundary", async () => {
	await verifyEvaluationBenchmarkBrowsing();
});

test("default benchmark browse spans current and retained result roots", async () => {
	const root = await temporaryRoot("bc-news-evaluation-browse-multi-root-");
	const appDirectory = join(root, "app");
	const currentDirectory = join(root, "invocation");
	const localDirectory = join(appDirectory, "local-data", "evaluation-results");
	const retainedDirectory = join(appDirectory, "evaluation-results");
	await Promise.all([
		mkdir(currentDirectory, { recursive: true }),
		mkdir(localDirectory, { recursive: true }),
		mkdir(retainedDirectory, { recursive: true }),
	]);

	const { result } = await controlledEvaluation();
	const currentRun = withArtifactIdentity(
		result.benchmark,
		"benchmark-current-default",
		"2026-08-17T12:00:00.000Z",
	);
	const retainedRun = withArtifactIdentity(
		result.benchmark,
		"benchmark-retained-default",
		"2026-08-17T11:00:00.000Z",
	);
	await Promise.all([
		writeFile(join(localDirectory, `${currentRun.id}.json`), `${JSON.stringify(currentRun, null, 2)}\n`, "utf8"),
		writeFile(join(retainedDirectory, `${retainedRun.id}.json`), `${JSON.stringify(retainedRun, null, 2)}\n`, "utf8"),
	]);

	const listOutput = await invokeCli(["benchmark", "list"], currentDirectory, appDirectory);
	expect(listOutput).toContain(currentRun.id);
	expect(listOutput).toContain(retainedRun.id);
	expect(listOutput.indexOf(currentRun.id)).toBeLessThan(listOutput.indexOf(retainedRun.id));

	const showOutput = await invokeCli(["benchmark", "show", retainedRun.id], currentDirectory, appDirectory);
	expect(BenchmarkRunSchema.safeParse(JSON.parse(showOutput) as unknown).success).toBe(true);

	const summaryOutput = await invokeCli(["benchmark", "summary", retainedRun.id], currentDirectory, appDirectory);
	expect(summaryOutput).toContain('"products"');
	expect(summaryOutput).toContain(retainedRun.id);

	const compareOutput = await invokeCli(
		["benchmark", "compare", retainedRun.id, currentRun.id],
		currentDirectory,
		appDirectory,
	);
	expect(compareOutput).toContain("Behavioral differences: none");
});

test("distinguishes an absent benchmark directory from a missing run", async () => {
	const root = await temporaryRoot("bc-news-evaluation-browse-reader-");
	expect(await listBenchmarkRuns(join(root, "absent"))).toEqual([]);
	await expect(loadBenchmarkRun("missing-run", join(root, "absent"))).rejects.toMatchObject({
		code: "benchmark_not_found",
	});
});

test("summarizes completed products with retained diagnostics", async () => {
	const { result } = await controlledEvaluation(undefined, 1, {
		main_story_write: await finalProductRejectedWriterOutput("main_story_write"),
	});
	expect(result.benchmark.trials[0]?.tracks.main_story.subject_outcome).toBe("completed");
	expect(result.benchmark.trials[0]?.tracks.main_story.findings).toEqual(expect.arrayContaining([
		expect.objectContaining({ kind: "final_product", code: "forbidden_marker" }),
	]));
	const summary = summarizeBenchmarkRun(result.benchmark);
	expect(result.benchmark.version).toBe(9);
	expect(summary.products).toEqual(expect.arrayContaining([
		expect.objectContaining({ track: "main_story", track_outcome: "completed" }),
	]));
	expect(summary.diagnostic_kind_counts).toMatchObject({ final_product: 1 });
});

test("keeps terminal schema findings out of diagnostic counts", async () => {
	const { result } = await controlledEvaluation(undefined, 1, {
		main_story_write: "not json",
	});
	const summary = summarizeBenchmarkRun(result.benchmark);

	expect(summary.finding_kind_counts).toMatchObject({ invalid_json: 1 });
	expect(summary.diagnostic_kind_counts).toEqual({});
});

test("compares retained diagnostics as behavior", async () => {
	const baseline = await controlledEvaluation();
	const diagnostic = await controlledEvaluation(undefined, 1, {
		main_story_write: await finalProductRejectedWriterOutput("main_story_write"),
	});
	const comparison = compareBenchmarkRuns(baseline.result.benchmark, diagnostic.result.benchmark);
	expect(comparison.behavioralDifferences).toEqual(expect.arrayContaining([
		expect.stringContaining("tracks.main_story.findings"),
	]));
});
