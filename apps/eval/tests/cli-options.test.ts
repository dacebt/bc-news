import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import { parseEvalCliCommand } from "../src/cli-options";
import {
	EVAL_CLI_USAGE,
	formatEvalCliFailure,
	runEvalCliApplication,
} from "../src/cli";
import {
	evalLocalDataRoot,
	resolveBenchmarkResultsDirectory,
	resolveCurrentLocalDataInputPath,
	resolveCurrentLocalDataResultsDirectory,
	resolveCurrentLocalDataSourcePath,
} from "../src/evaluation-local-artifact-cli";
import { RECORDED_REPLAY_CONFIG_PATH } from "../src/recorded-replay-acceptance-verifier";
import {
	RECORDED_OUTPUT_FIXTURE_PATH,
	REPRESENTATIVE_FIXTURE_PATH,
} from "../src/representative-fixture";
import { runCommand } from "../src/run-command";

const cliMocks = vi.hoisted(() => ({
	loadEvaluationReferenceCorpus: vi.fn(),
	loadLocalEvaluationReferenceCorpus: vi.fn(),
	formatEvaluationReferenceCorpusReport: vi.fn(() => "formatted corpus report"),
	extractProductionCorpus: vi.fn(),
	formatProductionCorpusExtractionReport: vi.fn(() => "formatted extraction report"),
	resolveEvaluationRepositoryRoot: vi.fn(),
}));

vi.mock("../src/evaluation-reference-corpus", async () => {
	const actual = await vi.importActual<typeof import("../src/evaluation-reference-corpus")>(
		"../src/evaluation-reference-corpus",
	);
	return {
		...actual,
		loadEvaluationReferenceCorpus: cliMocks.loadEvaluationReferenceCorpus,
		loadLocalEvaluationReferenceCorpus: cliMocks.loadLocalEvaluationReferenceCorpus,
	};
});

vi.mock("../src/evaluation-reference-corpus-report", async () => {
	const actual = await vi.importActual<typeof import("../src/evaluation-reference-corpus-report")>(
		"../src/evaluation-reference-corpus-report",
	);
	return {
		...actual,
		formatEvaluationReferenceCorpusReport: cliMocks.formatEvaluationReferenceCorpusReport,
	};
});

vi.mock("../src/evaluation-corpus-extraction", () => ({
	extractProductionCorpus: cliMocks.extractProductionCorpus,
}));

vi.mock("../src/evaluation-corpus-extraction-report", () => ({
	formatProductionCorpusExtractionReport: cliMocks.formatProductionCorpusExtractionReport,
}));

vi.mock("../src/evaluation-repository-reference", async () => {
	const actual = await vi.importActual<typeof import("../src/evaluation-repository-reference")>(
		"../src/evaluation-repository-reference",
	);
	return {
		...actual,
		resolveEvaluationRepositoryRoot: cliMocks.resolveEvaluationRepositoryRoot,
	};
});

beforeEach(() => {
	cliMocks.loadEvaluationReferenceCorpus.mockReset();
	cliMocks.loadLocalEvaluationReferenceCorpus.mockReset();
	cliMocks.formatEvaluationReferenceCorpusReport.mockReset().mockReturnValue("formatted corpus report");
	cliMocks.extractProductionCorpus.mockReset();
	cliMocks.formatProductionCorpusExtractionReport.mockReset().mockReturnValue("formatted extraction report");
	cliMocks.resolveEvaluationRepositoryRoot.mockReset().mockImplementation(async (currentDirectory: string) => {
		const actual = await vi.importActual<typeof import("../src/evaluation-repository-reference")>(
			"../src/evaluation-repository-reference",
		);
		return actual.resolveEvaluationRepositoryRoot(currentDirectory);
	});
});

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

async function seedAcceptanceRun(resultsDirectory: string): Promise<string> {
	const { run } = await runCommand({
		fixturePath: RECORDED_OUTPUT_FIXTURE_PATH,
		configPath: RECORDED_REPLAY_CONFIG_PATH,
		resultsDirectory,
		environment: {},
	});
	return run.id;
}

test("parses every verification ownership route", () => {
	expect(parseEvalCliCommand(["benchmark", "run", "--fixture", "fixture.json", "--config", "models.json"])).toEqual({
		command: "benchmark-run",
		fixturePath: "fixture.json",
		configPath: "models.json",
	});
	expect(parseEvalCliCommand(["benchmark", "list", "--results-dir", "runs"])).toEqual({ command: "benchmark-list", resultsDirectory: "runs" });
	expect(parseEvalCliCommand(["benchmark", "show", "benchmark-a", "--results-dir", "runs"])).toEqual({ command: "benchmark-show", runId: "benchmark-a", resultsDirectory: "runs" });
	expect(parseEvalCliCommand(["benchmark", "summary", "benchmark-a", "--results-dir", "runs"])).toEqual({ command: "benchmark-summary", runId: "benchmark-a", resultsDirectory: "runs" });
	expect(parseEvalCliCommand(["benchmark", "compare", "benchmark-a", "benchmark-b", "--results-dir", "runs"])).toEqual({ command: "benchmark-compare", leftRunId: "benchmark-a", rightRunId: "benchmark-b", resultsDirectory: "runs" });
	expect(parseEvalCliCommand(["scratch", "run", "--fixture", "fixture.json", "--config", "models.json", "--results-dir", "/tmp/runs"])).toEqual({
		command: "scratch-run",
		fixturePath: "fixture.json",
		configPath: "models.json",
		resultsDirectory: "/tmp/runs",
	});
	expect(parseEvalCliCommand(["acceptance", "run", "--fixture", "fixture.json"])).toEqual({ command: "acceptance-run", fixturePath: "fixture.json" });
	expect(parseEvalCliCommand(["acceptance", "list", "--results-dir", "runs"])).toEqual({ command: "acceptance-list", resultsDirectory: "runs" });
	expect(parseEvalCliCommand(["acceptance", "show", "run-a", "--results-dir", "runs"])).toEqual({ command: "acceptance-show", runId: "run-a", resultsDirectory: "runs" });
	expect(parseEvalCliCommand(["acceptance", "compare", "run-a", "run-b", "--results-dir", "runs"])).toEqual({ command: "acceptance-compare", leftRunId: "run-a", rightRunId: "run-b", resultsDirectory: "runs" });
	expect(parseEvalCliCommand(["fixture", "record-responses", "--fixture", "fixture.json", "--config", "models.json"])).toEqual({
		command: "fixture-record-responses",
		fixturePath: "fixture.json",
		configPath: "models.json",
	});
	expect(parseEvalCliCommand(["context", "benchmark", "--fixture", "fixture.json"])).toEqual({ command: "context-benchmark", fixturePath: "fixture.json" });
	expect(parseEvalCliCommand(["corpus", "extract", "--snapshot", "snapshot.sqlite", "--selection", "selection.json"])).toEqual({
		command: "corpus-extract",
		snapshotPath: "snapshot.sqlite",
		selectionPath: "selection.json",
	});
	expect(parseEvalCliCommand(["aggregate", "export", "--input", "scorecard-one.json", "--cohort", "baseline-a"])).toEqual({
		command: "aggregate-export",
		inputPath: "scorecard-one.json",
		cohortId: "baseline-a",
	});
	expect(parseEvalCliCommand(["aggregate", "show", "aggregate-a", "--results-dir", "summaries"])).toEqual({
		command: "aggregate-show",
		aggregateId: "aggregate-a",
		resultsDirectory: "summaries",
	});
	expect(parseEvalCliCommand(["aggregate", "compare", "aggregate-a", "aggregate-b", "--results-dir", "summaries"])).toEqual({
		command: "aggregate-compare",
		leftAggregateId: "aggregate-a",
		rightAggregateId: "aggregate-b",
		resultsDirectory: "summaries",
	});
	expect(EVAL_CLI_USAGE).toContain("pnpm --filter @bc-news/eval eval -- corpus extract --snapshot <path> --selection <path>");
});

test("keeps options with their owning namespace", () => {
	expect(parseEvalCliCommand(["benchmark", "run", "--fixture", "fixture.json", "--config", "models.json", "--results-dir", "benchmarks"])).toMatchObject({ resultsDirectory: "benchmarks" });
	expect(() => parseEvalCliCommand(["scratch", "run", "--fixture", "fixture.json", "--config", "models.json"])).toThrow("--results-dir is required");
	expect(parseEvalCliCommand(["acceptance", "run", "--fixture", "fixture.json", "--config", "recorded.json", "--results-dir", "acceptance"])).toMatchObject({ configPath: "recorded.json", resultsDirectory: "acceptance" });
	expect(parseEvalCliCommand(["fixture", "record-responses", "--fixture", "fixture.json", "--config", "models.json", "--response-dir", "responses"])).toMatchObject({ responseDirectory: "responses" });
	expect(parseEvalCliCommand(["context", "benchmark", "--fixture", "fixture.json", "--results-dir", "contexts"])).toMatchObject({ resultsDirectory: "contexts" });
	expect(parseEvalCliCommand(["corpus", "extract", "--snapshot", "snapshot.sqlite", "--selection", "selection.json"])).toMatchObject({
		snapshotPath: "snapshot.sqlite",
		selectionPath: "selection.json",
	});
	expect(parseEvalCliCommand(["aggregate", "export", "--input", "scorecard-one.json", "--cohort", "baseline-a", "--results-dir", "summaries"])).toMatchObject({
		resultsDirectory: "summaries",
	});
	expect(() => parseEvalCliCommand(["benchmark", "list", "--response-dir", "responses"])).toThrow("--response-dir is not valid for the benchmark list command");
	expect(() => parseEvalCliCommand(["acceptance", "list", "--config", "recorded.json"])).toThrow("--config is not valid for the acceptance list command");
	expect(() => parseEvalCliCommand(["fixture", "record-responses", "--fixture", "fixture.json", "--config", "models.json", "--results-dir", "results"])).toThrow("--results-dir is not valid for the fixture record-responses command");
	expect(() => parseEvalCliCommand(["context", "benchmark", "--fixture", "fixture.json", "--config", "models.json"])).toThrow("--config is not valid for the context benchmark command");
	expect(() => parseEvalCliCommand(["corpus", "extract", "--corpus", "manifest.json"])).toThrow("--corpus is not valid for the corpus extract command");
	expect(() => parseEvalCliCommand(["corpus", "show", "--snapshot", "snapshot.sqlite"])).toThrow("--snapshot is not valid for the corpus show command");
	expect(() => parseEvalCliCommand(["aggregate", "export", "--input", "scorecard-one.json"])).toThrow("--cohort is required");
	expect(() => parseEvalCliCommand(["aggregate", "show", "aggregate-a", "--cohort", "baseline-a"])).toThrow("--cohort is not valid for the aggregate show command");
});

test("rejects every removed bare route and omits it from help", () => {
	for (const route of ["evaluate", "run", "record", "context", "list", "show", "compare"]) {
		expect(() => parseEvalCliCommand([route])).toThrow();
	}
	for (const bareInvocation of [
		"eval -- evaluate ",
		"eval -- run ",
		"eval -- record ",
		"eval -- context --",
		"eval -- list",
		"eval -- show ",
		"eval -- compare ",
	]) {
		expect(EVAL_CLI_USAGE).not.toContain(bareInvocation);
	}
});

test("formats failures through the recognized verification namespace", () => {
	expect(formatEvalCliFailure(["benchmark", "unknown"], new Error("bad route"))).toBe("benchmark failed: bad route");
	expect(formatEvalCliFailure(["scratch", "unknown"], new Error("bad route"))).toBe("scratch failed: bad route");
	expect(formatEvalCliFailure(["acceptance", "unknown"], new Error("bad route"))).toBe("acceptance failed: bad route");
	expect(formatEvalCliFailure(["fixture", "unknown"], new Error("bad route"))).toBe("fixture authoring failed: bad route");
	expect(formatEvalCliFailure(["context", "unknown"], new Error("bad route"))).toBe("context benchmark failed: bad route");
	expect(formatEvalCliFailure(["corpus", "unknown"], new Error("bad route"))).toBe("corpus failed: bad route");
	expect(formatEvalCliFailure(["aggregate", "unknown"], new Error("bad route"))).toBe("aggregate failed: bad route");
	expect(formatEvalCliFailure(["unknown"], new Error("bad route"))).toBe("command failed: bad route");
});

test("prints usage for help requests", async () => {
	await expect(invokeCli(["--help"], "/workspace", "/workspace/apps/eval")).resolves.toBe(`${EVAL_CLI_USAGE}\n`);
});

test("rejects recorded scratch configuration before creating an artifact directory", async () => {
	const root = await mkdtemp(join(tmpdir(), "bc-news-cli-scratch-live-config-"));
	const resultsDirectory = join(root, "scratch-results");

	await expect(invokeCli([
		"scratch",
		"run",
		"--fixture",
		REPRESENTATIVE_FIXTURE_PATH,
		"--config",
		RECORDED_REPLAY_CONFIG_PATH,
		"--results-dir",
		resultsDirectory,
	], root, join(root, "apps/eval"))).rejects.toMatchObject({
		code: "recorded_adapter_rejected_for_live_evaluation",
	});
	await expect(access(resultsDirectory)).rejects.toMatchObject({ code: "ENOENT" });
});

test("rejects scratch artifacts inside current and legacy benchmark stores before loading configuration", async () => {
	const root = await mkdtemp(join(tmpdir(), "bc-news-cli-scratch-results-boundary-"));
	const appDirectory = join(root, "apps/eval");
	for (const resultsDirectory of [
		join(appDirectory, "local-data/evaluation-results/scratch"),
		join(appDirectory, "evaluation-results/scratch"),
	]) {
		await expect(invokeCli([
			"scratch",
			"run",
			"--fixture",
			REPRESENTATIVE_FIXTURE_PATH,
			"--config",
			RECORDED_REPLAY_CONFIG_PATH,
			"--results-dir",
			resultsDirectory,
		], root, appDirectory)).rejects.toMatchObject({
			code: "scratch_results_directory_reserved",
		});
		await expect(access(resultsDirectory)).rejects.toMatchObject({ code: "ENOENT" });
	}
});

test("defaults current evaluation storage under the ignored local-data root", () => {
	const appDirectory = "/workspace/apps/eval";
	const currentDirectory = "/workspace";

	expect(evalLocalDataRoot(appDirectory)).toBe("/workspace/apps/eval/local-data");
	expect(resolveBenchmarkResultsDirectory(currentDirectory, appDirectory, undefined)).toBe("/workspace/apps/eval/local-data/evaluation-results");
	expect(resolveCurrentLocalDataResultsDirectory(currentDirectory, appDirectory, undefined, "scorecards", "Current scorecard results directory")).toBe(
		"/workspace/apps/eval/local-data/scorecards",
	);
	expect(resolveCurrentLocalDataResultsDirectory(currentDirectory, appDirectory, undefined, "longitudinal-scorecards", "Current longitudinal results directory")).toBe(
		"/workspace/apps/eval/local-data/longitudinal-scorecards",
	);
});

test("rejects current declarations and explicit current results outside local-data", () => {
	const appDirectory = "/workspace/apps/eval";
	const currentDirectory = "/workspace";

	expect(resolveCurrentLocalDataInputPath(currentDirectory, appDirectory, "apps/eval/local-data/scorecards/declaration.json", "Current scorecard declaration")).toBe(
		"/workspace/apps/eval/local-data/scorecards/declaration.json",
	);
	expect(resolveCurrentLocalDataSourcePath(currentDirectory, appDirectory, "apps/eval/local-data/scorecards/declaration.json", "Current scorecard declaration")).toBe(
		"scorecards/declaration.json",
	);
	expect(() => resolveCurrentLocalDataInputPath(currentDirectory, appDirectory, "apps/eval/scorecards/declaration.json", "Current scorecard declaration")).toThrow(
		"Current scorecard declaration must be contained within /workspace/apps/eval/local-data",
	);
	expect(() => resolveCurrentLocalDataResultsDirectory(currentDirectory, appDirectory, "apps/eval/scorecard-results", "scorecards", "Current scorecard results directory")).toThrow(
		"Current scorecard results directory must be contained within /workspace/apps/eval/local-data",
	);
});

test("routes corpus extract through resolved snapshot, selection, and local-data root", async () => {
	cliMocks.extractProductionCorpus.mockResolvedValue({ extraction: "ok" });

	const output = await invokeCli(
		["corpus", "extract", "--snapshot", "fixtures/production.sqlite", "--selection", "apps/eval/production-corpus-selection.json"],
		"/workspace",
		"/workspace/apps/eval",
	);

	expect(cliMocks.extractProductionCorpus).toHaveBeenCalledWith({
		snapshotPath: "/workspace/fixtures/production.sqlite",
		selectionPath: "/workspace/apps/eval/production-corpus-selection.json",
		localDataRoot: "/workspace/apps/eval/local-data",
	});
	expect(cliMocks.formatProductionCorpusExtractionReport).toHaveBeenCalledWith({ extraction: "ok" });
	expect(output).toBe("formatted extraction report\n");
});

test("loads local-data corpus manifests through the local corpus loader", async () => {
	cliMocks.loadLocalEvaluationReferenceCorpus.mockResolvedValue({ corpus: "local" });

	const output = await invokeCli(
		["corpus", "show", "--corpus", "apps/eval/local-data/corpus-workspaces/sample/reference-corpus/manifest.json"],
		"/workspace",
		"/workspace/apps/eval",
	);

	expect(cliMocks.loadLocalEvaluationReferenceCorpus).toHaveBeenCalledWith(
		"/workspace/apps/eval/local-data",
		"corpus-workspaces/sample/reference-corpus/manifest.json",
	);
	expect(cliMocks.loadEvaluationReferenceCorpus).not.toHaveBeenCalled();
	expect(cliMocks.resolveEvaluationRepositoryRoot).not.toHaveBeenCalled();
	expect(output).toBe("formatted corpus report\n");
});

test("keeps local-data prefix counterexamples on the repository corpus loader", async () => {
	cliMocks.loadEvaluationReferenceCorpus.mockResolvedValue({ corpus: "repository" });
	cliMocks.resolveEvaluationRepositoryRoot.mockResolvedValueOnce("/workspace/repo-root");

	const output = await invokeCli(
		["corpus", "show", "--corpus", "apps/eval/local-data-prefix/reference-corpus/manifest.json"],
		"/workspace",
		"/workspace/apps/eval",
	);

	expect(cliMocks.loadLocalEvaluationReferenceCorpus).not.toHaveBeenCalled();
	expect(cliMocks.resolveEvaluationRepositoryRoot).toHaveBeenCalledWith("/workspace");
	expect(cliMocks.loadEvaluationReferenceCorpus).toHaveBeenCalledWith(
		"/workspace/apps/eval/local-data-prefix/reference-corpus/manifest.json",
		"/workspace/repo-root",
	);
	expect(output).toBe("formatted corpus report\n");
});

test("defaults acceptance browsing to local-data acceptance-results and preserves explicit --results-dir", async () => {
	const root = await mkdtemp(join(tmpdir(), "bc-news-cli-acceptance-results-"));
	const currentDirectory = join(root, "workspace");
	const appDirectory = join(currentDirectory, "apps/eval");
	const defaultRunId = await seedAcceptanceRun(join(appDirectory, "local-data/acceptance-results"));
	const explicitRunId = await seedAcceptanceRun(join(appDirectory, "custom-acceptance-results"));

	const defaultOutput = await invokeCli(["acceptance", "list"], currentDirectory, appDirectory);
	const explicitOutput = await invokeCli(
		["acceptance", "list", "--results-dir", "apps/eval/custom-acceptance-results"],
		currentDirectory,
		appDirectory,
	);

	expect(defaultOutput).toContain(defaultRunId);
	expect(defaultOutput).not.toContain(explicitRunId);
	expect(explicitOutput).toContain(explicitRunId);
	expect(explicitOutput).not.toContain(defaultRunId);
}, 30_000);
