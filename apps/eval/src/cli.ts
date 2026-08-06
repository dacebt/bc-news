import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compareRuns } from "./compare";
import { parseEvalCliCommand } from "./cli-options";
import { runContextBenchmark } from "./context-benchmark-command";
import { formatContextBenchmarkReport } from "./context-benchmark-report";
import { recordCommand } from "./record-command";
import { evaluateBenchmarkCommand } from "./evaluation-benchmark-command";
import { formatEvaluationTrialReport } from "./evaluation-report";
import {
	formatRecordSummary,
	formatRunComparison,
	formatRunDetail,
	formatRunListing,
	formatRunSummary,
} from "./report";
import { listRunFiles, loadRunFile } from "./run-file";
import { runCommand } from "./run-command";

const USAGE = `Usage:
  pnpm --filter @bc-news/eval eval -- evaluate --fixture <path> --config <path> [--results-dir <path>]
  pnpm --filter @bc-news/eval eval -- run --fixture <path> [--config <path>] [--results-dir <path>]
  pnpm --filter @bc-news/eval eval -- record --fixture <path> --config <path> [--response-dir <path>]
  pnpm --filter @bc-news/eval eval -- context --fixture <path> [--results-dir <path>]
  pnpm --filter eval run eval -- list [--results-dir <path>]
  pnpm --filter eval run eval -- show <run-id> [--results-dir <path>]
  pnpm --filter eval run eval -- compare <left-run-id> <right-run-id> [--results-dir <path>]`;

/**
 * `pnpm --filter eval run eval` executes with cwd rewritten to apps/eval, not
 * the directory the user invoked pnpm from -- but pnpm sets INIT_CWD to that
 * original directory (a documented lifecycle convention), so relative paths
 * on the command line resolve the way the user typed them, not against the
 * package directory.
 */
function invocationCwd(): string {
	return process.env.INIT_CWD ?? process.cwd();
}

async function main(): Promise<void> {
	// `pnpm run eval -- run ...` forwards the literal `--` separator into argv
	// (pnpm does not strip it); a leading one is a pass-through marker, never a
	// command name, so it is dropped before dispatch.
	const argv = process.argv.slice(2);
	if (argv[0] === "--") argv.shift();
	if (argv.length === 0 || argv[0] === "--help") {
		process.stdout.write(`${USAGE}\n`);
		return;
	}
	const command = parseEvalCliCommand(argv);
	const cwd = invocationCwd();
	const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");

	/*
	 * The committed apps/eval/results directory is the default results
	 * directory (retained evidence lives with the app, not wherever pnpm was
	 * invoked from) so it resolves against the app directory, not INIT_CWD --
	 * mirroring the --config default. A user-typed --results-dir resolves
	 * where the user typed it, same as --config.
	 */
	function resultsDirectoryFor(resultsDirectory: string | undefined): string {
		return resultsDirectory === undefined
			? resolve(appDirectory, "results")
			: resolve(cwd, resultsDirectory);
	}

	if (command.command === "evaluate") {
		const result = await evaluateBenchmarkCommand({
			fixturePath: resolve(cwd, command.fixturePath),
			configPath: resolve(cwd, command.configPath),
			resultsDirectory: command.resultsDirectory === undefined
				? resolve(appDirectory, "evaluation-results")
				: resolve(cwd, command.resultsDirectory),
		});
		process.stdout.write(`${formatEvaluationTrialReport(result.benchmark, result.path)}\n`);
		return;
	}

	if (command.command === "run") {
		/*
		 * The committed eval.config.json is the default so the retained-evidence
		 * config is reachable without a flag; it resolves against the app
		 * directory, not INIT_CWD, because its location is fixed by the repo
		 * while user-typed --config paths resolve where the user typed them.
		 */
		const defaultConfigPath = resolve(appDirectory, "eval.config.json");
		const saved = await runCommand({
			fixturePath: resolve(cwd, command.fixturePath),
			configPath:
				command.configPath === undefined ? defaultConfigPath : resolve(cwd, command.configPath),
			resultsDirectory: resultsDirectoryFor(command.resultsDirectory),
		});
		process.stdout.write(`${formatRunSummary(saved.run, saved.path)}\n`);
		return;
	}
	if (command.command === "record") {
		/*
		 * The retained response set lives at the workspace level, so its default
		 * resolves from the app's fixed repository location. A user-typed
		 * --response-dir still resolves from the directory that invoked pnpm.
		 */
		const defaultResponseDirectory = resolve(appDirectory, "../../packages/fixtures/model-responses");
		const result = await recordCommand({
			fixturePath: resolve(cwd, command.fixturePath),
			configPath: resolve(cwd, command.configPath),
			responseDirectory: command.responseDirectory === undefined
				? defaultResponseDirectory
				: resolve(cwd, command.responseDirectory),
			environment: process.env,
		});
		process.stdout.write(`${formatRecordSummary(result)}\n`);
		return;
	}
	if (command.command === "context") {
		const defaultResultsDirectory = resolve(appDirectory, "context-results");
		const resultsDirectory = command.resultsDirectory === undefined
			? defaultResultsDirectory
			: resolve(cwd, command.resultsDirectory);
		const saved = await runContextBenchmark({
			fixturePath: resolve(cwd, command.fixturePath),
			resultsDirectory,
		});
		process.stdout.write(`${formatContextBenchmarkReport(saved.report, saved.path)}\n`);
		return;
	}
	if (command.command === "list") {
		const runs = await listRunFiles(resultsDirectoryFor(command.resultsDirectory));
		process.stdout.write(`${formatRunListing(runs)}\n`);
		return;
	}
	if (command.command === "show") {
		const run = await loadRunFile(command.runId, resultsDirectoryFor(command.resultsDirectory));
		process.stdout.write(`${formatRunDetail(run)}\n`);
		return;
	}
	const directory = resultsDirectoryFor(command.resultsDirectory);
	const left = await loadRunFile(command.leftRunId, directory);
	const right = await loadRunFile(command.rightRunId, directory);
	process.stdout.write(`${formatRunComparison(compareRuns(left, right))}\n`);
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`eval failed: ${message}\n`);
	process.exitCode = 1;
});
