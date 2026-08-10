import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compareRuns } from "./compare";
import { parseEvalCliCommand } from "./cli-options";
import { runContextBenchmark } from "./context-benchmark-command";
import { formatContextBenchmarkReport } from "./context-benchmark-report";
import { recordCommand } from "./record-command";
import { evaluateBenchmarkCommand } from "./evaluation-benchmark-command";
import {
	formatBenchmarkComparison,
	formatBenchmarkDetail,
	formatBenchmarkListing,
	formatBenchmarkSummary,
} from "./evaluation-browse-report";
import { compareBenchmarkRuns } from "./evaluation-comparison";
import { listBenchmarkRuns, loadBenchmarkRun } from "./evaluation-artifact-reader";
import { formatBenchmarkRunReport } from "./benchmark-run-report";
import {
	formatRecordSummary,
	formatRunComparison,
	formatRunDetail,
	formatRunListing,
	formatRunSummary,
} from "./report";
import { listRunFiles, loadRunFile } from "./run-file";
import { runCommand } from "./run-command";
import { loadEvaluationReferenceCorpus } from "./evaluation-reference-corpus";
import { formatEvaluationReferenceCorpusReport } from "./evaluation-reference-corpus-report";

export const EVAL_CLI_USAGE = `Usage:
  pnpm --filter @bc-news/eval eval -- benchmark run --fixture <path> --config <path> [--results-dir <path>]
  pnpm --filter @bc-news/eval eval -- benchmark list [--results-dir <path>]
  pnpm --filter @bc-news/eval eval -- benchmark show <benchmark-run-id> [--results-dir <path>]
  pnpm --filter @bc-news/eval eval -- benchmark summary <benchmark-run-id> [--results-dir <path>]
  pnpm --filter @bc-news/eval eval -- benchmark compare <left-id> <right-id> [--results-dir <path>]
  pnpm --filter @bc-news/eval eval -- acceptance run --fixture <path> [--config <path>] [--results-dir <path>]
  pnpm --filter @bc-news/eval eval -- acceptance list [--results-dir <path>]
  pnpm --filter @bc-news/eval eval -- acceptance show <run-id> [--results-dir <path>]
  pnpm --filter @bc-news/eval eval -- acceptance compare <left-id> <right-id> [--results-dir <path>]
  pnpm --filter @bc-news/eval eval -- fixture record-responses --fixture <path> --config <path> [--response-dir <path>]
  pnpm --filter @bc-news/eval eval -- context benchmark --fixture <path> [--results-dir <path>]
  pnpm --filter @bc-news/eval eval -- corpus show --corpus <manifest-path>`;

export interface EvalCliApplicationOptions {
	readonly argv: readonly string[];
	readonly currentDirectory: string;
	readonly appDirectory: string;
	readonly environment: NodeJS.ProcessEnv;
	readonly writeOutput: (text: string) => void;
}

function commandArguments(argv: readonly string[]): readonly string[] {
	return argv[0] === "--" ? argv.slice(1) : argv;
}

export function evalCliFailurePrefix(argv: readonly string[]): string {
	const namespace = commandArguments(argv)[0];
	if (namespace === "benchmark") return "benchmark failed:";
	if (namespace === "acceptance") return "acceptance failed:";
	if (namespace === "fixture") return "fixture authoring failed:";
	if (namespace === "context") return "context benchmark failed:";
	if (namespace === "corpus") return "corpus failed:";
	return "command failed:";
}

export function formatEvalCliFailure(argv: readonly string[], error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return `${evalCliFailurePrefix(argv)} ${message}`;
}

export async function runEvalCliApplication(options: EvalCliApplicationOptions): Promise<void> {
	const argv = commandArguments(options.argv);
	if (argv.length === 0 || argv[0] === "--help") {
		options.writeOutput(`${EVAL_CLI_USAGE}\n`);
		return;
	}
	const command = parseEvalCliCommand(argv);
	const cwd = options.environment.INIT_CWD ?? options.currentDirectory;
	const appDirectory = options.appDirectory;
	const writeLine = (value: string): void => options.writeOutput(`${value}\n`);

	function acceptanceResultsDirectoryFor(resultsDirectory: string | undefined): string {
		return resultsDirectory === undefined
			? resolve(appDirectory, "results")
			: resolve(cwd, resultsDirectory);
	}

	function evaluationResultsDirectoryFor(resultsDirectory: string | undefined): string {
		return resultsDirectory === undefined
			? resolve(appDirectory, "evaluation-results")
			: resolve(cwd, resultsDirectory);
	}

	if (command.command === "benchmark-run") {
		const result = await evaluateBenchmarkCommand({
			fixturePath: resolve(cwd, command.fixturePath),
			configPath: resolve(cwd, command.configPath),
			resultsDirectory: evaluationResultsDirectoryFor(command.resultsDirectory),
			environment: options.environment,
		});
		writeLine(formatBenchmarkRunReport(result.benchmark, result.path));
		return;
	}
	if (command.command === "benchmark-list") {
		const runs = await listBenchmarkRuns(evaluationResultsDirectoryFor(command.resultsDirectory));
		writeLine(formatBenchmarkListing(runs));
		return;
	}
	if (command.command === "benchmark-show") {
		const run = await loadBenchmarkRun(command.runId, evaluationResultsDirectoryFor(command.resultsDirectory));
		writeLine(formatBenchmarkDetail(run));
		return;
	}
	if (command.command === "benchmark-summary") {
		const run = await loadBenchmarkRun(command.runId, evaluationResultsDirectoryFor(command.resultsDirectory));
		writeLine(formatBenchmarkSummary(run));
		return;
	}
	if (command.command === "benchmark-compare") {
		const directory = evaluationResultsDirectoryFor(command.resultsDirectory);
		const left = await loadBenchmarkRun(command.leftRunId, directory);
		const right = await loadBenchmarkRun(command.rightRunId, directory);
		writeLine(formatBenchmarkComparison(compareBenchmarkRuns(left, right)));
		return;
	}

	if (command.command === "acceptance-run") {
		const defaultConfigPath = resolve(appDirectory, "recorded-replay.config.json");
		const saved = await runCommand({
			fixturePath: resolve(cwd, command.fixturePath),
			configPath: command.configPath === undefined ? defaultConfigPath : resolve(cwd, command.configPath),
			resultsDirectory: acceptanceResultsDirectoryFor(command.resultsDirectory),
		});
		writeLine(formatRunSummary(saved.run, saved.path));
		return;
	}
	if (command.command === "acceptance-list") {
		const runs = await listRunFiles(acceptanceResultsDirectoryFor(command.resultsDirectory));
		writeLine(formatRunListing(runs));
		return;
	}
	if (command.command === "acceptance-show") {
		const run = await loadRunFile(command.runId, acceptanceResultsDirectoryFor(command.resultsDirectory));
		writeLine(formatRunDetail(run));
		return;
	}
	if (command.command === "acceptance-compare") {
		const directory = acceptanceResultsDirectoryFor(command.resultsDirectory);
		const left = await loadRunFile(command.leftRunId, directory);
		const right = await loadRunFile(command.rightRunId, directory);
		writeLine(formatRunComparison(compareRuns(left, right)));
		return;
	}

	if (command.command === "fixture-record-responses") {
		const defaultResponseDirectory = resolve(appDirectory, "../../packages/fixtures/model-responses");
		const result = await recordCommand({
			fixturePath: resolve(cwd, command.fixturePath),
			configPath: resolve(cwd, command.configPath),
			responseDirectory: command.responseDirectory === undefined
				? defaultResponseDirectory
				: resolve(cwd, command.responseDirectory),
			environment: options.environment,
		});
		writeLine(formatRecordSummary(result));
		return;
	}
	if (command.command === "corpus-show") {
		writeLine(formatEvaluationReferenceCorpusReport(await loadEvaluationReferenceCorpus(resolve(cwd, command.corpusPath))));
		return;
	}

	const resultsDirectory = command.resultsDirectory === undefined
		? resolve(appDirectory, "context-results")
		: resolve(cwd, command.resultsDirectory);
	const saved = await runContextBenchmark({
		fixturePath: resolve(cwd, command.fixturePath),
		resultsDirectory,
	});
	writeLine(formatContextBenchmarkReport(saved.report, saved.path));
}

async function main(): Promise<void> {
	await runEvalCliApplication({
		argv: process.argv.slice(2),
		currentDirectory: process.cwd(),
		appDirectory: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
		environment: process.env,
		writeOutput: (text) => process.stdout.write(text),
	});
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error: unknown) => {
		process.stderr.write(`${formatEvalCliFailure(process.argv.slice(2), error)}\n`);
		process.exitCode = 1;
	});
}
