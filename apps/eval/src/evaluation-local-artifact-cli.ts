import { mkdir } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { BenchmarkRun } from "./evaluation-artifact";
import { BenchmarkRunReadError, listBenchmarkRuns, loadBenchmarkRun } from "./evaluation-artifact-reader";
import { buildEvaluationAggregateResult } from "./evaluation-aggregate-result-builder";
import {
	compareEvaluationAggregateResults,
	formatEvaluationAggregateResultComparison,
} from "./evaluation-aggregate-result-comparison";
import { EvaluationAggregateResultError } from "./evaluation-aggregate-result";
import { formatEvaluationAggregateResultReport } from "./evaluation-aggregate-result-report";
import {
	createEvaluationAggregateResultArtifact,
	loadEvaluationAggregateResultArtifact,
} from "./evaluation-aggregate-result-store";
import { buildEvaluationLongitudinalScorecard } from "./evaluation-longitudinal-scorecard-builder";
import { loadEvaluationLongitudinalInput } from "./evaluation-longitudinal-scorecard-input";
import { formatEvaluationLongitudinalScorecardReport } from "./evaluation-longitudinal-scorecard-report";
import {
	createEvaluationLongitudinalScorecardArtifact,
	evaluationLongitudinalFreshness,
	loadEvaluationLongitudinalScorecardArtifact,
} from "./evaluation-longitudinal-scorecard-store";
import { buildEvaluationScorecard } from "./evaluation-scorecard-builder";
import { loadEvaluationScorecardInput } from "./evaluation-scorecard-input";
import { formatEvaluationScorecardReport } from "./evaluation-scorecard-report";
import {
	createEvaluationScorecardArtifact,
	evaluationScorecardFreshness,
	loadEvaluationScorecardArtifact,
} from "./evaluation-scorecard-store";
import { CliOptionsError } from "./cli-options";
import { safeEvaluationId } from "./evaluation-trial-support";

const LOCAL_DATA_DIRECTORY = "local-data";
const BENCHMARK_RESULTS_DIRECTORY = "evaluation-results";

type CurrentResultsDirectory = "scorecards" | "longitudinal-scorecards";

export interface EvaluationLocalArtifactCliContext {
	readonly currentDirectory: string;
	readonly appDirectory: string;
	readonly repositoryRoot: string;
	readonly localDataRoot: string;
}

function pathIsContainedWithin(container: string, candidate: string): boolean {
	const relation = relative(container, candidate);
	return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

function benchmarkSort(left: BenchmarkRun, right: BenchmarkRun): number {
	const chronological = Date.parse(right.started_at) - Date.parse(left.started_at);
	return chronological !== 0 ? chronological : right.id.localeCompare(left.id);
}

function artifactRoots(context: EvaluationLocalArtifactCliContext) {
	return {
		repositoryRoot: context.repositoryRoot,
		localDataRoot: context.localDataRoot,
	};
}

function scorecardResultsDirectoryFor(
	context: EvaluationLocalArtifactCliContext,
	resultsDirectory: string | undefined,
): string {
	return resolveCurrentLocalDataResultsDirectory(
		context.currentDirectory,
		context.appDirectory,
		resultsDirectory,
		"scorecards",
		"Current scorecard results directory",
	);
}

function scorecardShowResultsDirectoryFor(
	context: EvaluationLocalArtifactCliContext,
	resultsDirectory: string | undefined,
): string {
	return resultsDirectory === undefined
		? resolve(context.localDataRoot, "scorecards")
		: resolve(context.currentDirectory, resultsDirectory);
}

function aggregateResultsDirectoryFor(
	context: EvaluationLocalArtifactCliContext,
	resultsDirectory: string | undefined,
): string {
	return resultsDirectory === undefined
		? resolve(context.appDirectory, "summaries")
		: resolve(context.currentDirectory, resultsDirectory);
}

function longitudinalResultsDirectoryFor(
	context: EvaluationLocalArtifactCliContext,
	resultsDirectory: string | undefined,
): string {
	return resolveCurrentLocalDataResultsDirectory(
		context.currentDirectory,
		context.appDirectory,
		resultsDirectory,
		"longitudinal-scorecards",
		"Current longitudinal results directory",
	);
}

function longitudinalShowResultsDirectoryFor(
	context: EvaluationLocalArtifactCliContext,
	resultsDirectory: string | undefined,
): string {
	return resultsDirectory === undefined
		? resolve(context.localDataRoot, "longitudinal-scorecards")
		: resolve(context.currentDirectory, resultsDirectory);
}

function benchmarkBrowseDirectories(
	currentDirectory: string,
	appDirectory: string,
	resultsDirectory: string | undefined,
): readonly string[] {
	if (resultsDirectory !== undefined) {
		return [resolve(currentDirectory, resultsDirectory)];
	}
	return resolveDefaultBenchmarkBrowseDirectories(appDirectory);
}

export function resolveDefaultBenchmarkBrowseDirectories(appDirectory: string): readonly string[] {
	return [
		resolve(evalLocalDataRoot(appDirectory), BENCHMARK_RESULTS_DIRECTORY),
		resolve(appDirectory, BENCHMARK_RESULTS_DIRECTORY),
	];
}

async function loadBenchmarkRunFromDirectories(
	id: string,
	directories: readonly string[],
): Promise<BenchmarkRun> {
	let missingError: BenchmarkRunReadError | undefined;
	for (const directory of directories) {
		try {
			return await loadBenchmarkRun(id, directory);
		} catch (error) {
			if (error instanceof BenchmarkRunReadError && error.code === "benchmark_not_found") {
				missingError ??= error;
				continue;
			}
			throw error;
		}
	}
	if (missingError !== undefined) {
		throw missingError;
	}
	throw new BenchmarkRunReadError(
		"benchmark_not_found",
		join(directories[0] ?? "", `${id}.json`),
		`Benchmark Run not found: ${id}`,
	);
}

function scorecardReportFreshness(
	artifact: Awaited<ReturnType<typeof loadEvaluationScorecardArtifact>>,
	repositoryRoot: string,
) {
	if (artifact.version === 1) {
		return Promise.resolve(undefined);
	}
	return evaluationScorecardFreshness(artifact, repositoryRoot);
}

function longitudinalReportFreshness(
	artifact: Awaited<ReturnType<typeof loadEvaluationLongitudinalScorecardArtifact>>,
	repositoryRoot: string,
) {
	if (artifact.version === 1) {
		return Promise.resolve(undefined);
	}
	if (artifact.version === 2) {
		return Promise.resolve([]);
	}
	return evaluationLongitudinalFreshness(artifact, repositoryRoot);
}

export function evalLocalDataRoot(appDirectory: string): string {
	return resolve(appDirectory, LOCAL_DATA_DIRECTORY);
}

export function resolveBenchmarkResultsDirectory(
	currentDirectory: string,
	appDirectory: string,
	resultsDirectory: string | undefined,
): string {
	return resultsDirectory === undefined
		? resolve(evalLocalDataRoot(appDirectory), BENCHMARK_RESULTS_DIRECTORY)
		: resolve(currentDirectory, resultsDirectory);
}

export function resolveCurrentLocalDataInputPath(
	currentDirectory: string,
	appDirectory: string,
	inputPath: string,
	label: string,
): string {
	const resolvedPath = resolve(currentDirectory, inputPath);
	const localDataRoot = evalLocalDataRoot(appDirectory);
	if (!pathIsContainedWithin(localDataRoot, resolvedPath)) {
		throw new CliOptionsError(`${label} must be contained within ${localDataRoot}`);
	}
	return resolvedPath;
}

export function resolveCurrentLocalDataSourcePath(
	currentDirectory: string,
	appDirectory: string,
	inputPath: string,
	label: string,
): string {
	return relative(
		evalLocalDataRoot(appDirectory),
		resolveCurrentLocalDataInputPath(currentDirectory, appDirectory, inputPath, label),
	).split(sep).join("/");
}

export function resolveCurrentLocalDataResultsDirectory(
	currentDirectory: string,
	appDirectory: string,
	resultsDirectory: string | undefined,
	defaultDirectory: CurrentResultsDirectory,
	label: string,
): string {
	const localDataRoot = evalLocalDataRoot(appDirectory);
	const resolvedPath = resultsDirectory === undefined
		? resolve(localDataRoot, defaultDirectory)
		: resolve(currentDirectory, resultsDirectory);
	if (resultsDirectory !== undefined && !pathIsContainedWithin(localDataRoot, resolvedPath)) {
		throw new CliOptionsError(`${label} must be contained within ${localDataRoot}`);
	}
	return resolvedPath;
}

export async function listBenchmarkRunsForCli(
	currentDirectory: string,
	appDirectory: string,
	resultsDirectory: string | undefined,
): Promise<BenchmarkRun[]> {
	const directories = benchmarkBrowseDirectories(currentDirectory, appDirectory, resultsDirectory);
	const listed = await Promise.all(directories.map(async (directory) => listBenchmarkRuns(directory)));
	const byId = new Map<string, BenchmarkRun>();
	for (const runs of listed) {
		for (const run of runs) {
			if (!byId.has(run.id)) {
				byId.set(run.id, run);
			}
		}
	}
	return [...byId.values()].sort(benchmarkSort);
}

export async function loadBenchmarkRunForCli(
	id: string,
	currentDirectory: string,
	appDirectory: string,
	resultsDirectory: string | undefined,
): Promise<BenchmarkRun> {
	return loadBenchmarkRunFromDirectories(
		id,
		benchmarkBrowseDirectories(currentDirectory, appDirectory, resultsDirectory),
	);
}

export async function buildEvaluationScorecardReportForCli(
	context: EvaluationLocalArtifactCliContext,
	inputPath: string,
	resultsDirectory: string | undefined,
): Promise<string> {
	const declarationPath = resolveCurrentLocalDataSourcePath(
		context.currentDirectory,
		context.appDirectory,
		inputPath,
		"Current scorecard declaration",
	);
	const outputDirectory = scorecardResultsDirectoryFor(context, resultsDirectory);
	await mkdir(outputDirectory, { recursive: true });
	const input = await loadEvaluationScorecardInput(declarationPath, context.localDataRoot);
	const artifact = buildEvaluationScorecard(input, {
		id: safeEvaluationId("scorecard"),
		createdAt: new Date().toISOString(),
	});
	await createEvaluationScorecardArtifact(
		join(outputDirectory, `${artifact.id}.json`),
		artifact,
		artifactRoots(context),
	);
	const saved = await loadEvaluationScorecardArtifact(artifact.id, outputDirectory, artifactRoots(context));
	return formatEvaluationScorecardReport(
		saved,
		await scorecardReportFreshness(saved, context.repositoryRoot),
	);
}

export async function showEvaluationScorecardReportForCli(
	context: EvaluationLocalArtifactCliContext,
	scorecardId: string,
	resultsDirectory: string | undefined,
): Promise<string> {
	const saved = await loadEvaluationScorecardArtifact(
		scorecardId,
		scorecardShowResultsDirectoryFor(context, resultsDirectory),
		artifactRoots(context),
	);
	return formatEvaluationScorecardReport(
		saved,
		await scorecardReportFreshness(saved, context.repositoryRoot),
	);
}

export async function exportEvaluationAggregateResultForCli(
	context: EvaluationLocalArtifactCliContext,
	inputPath: string,
	cohortId: string,
	resultsDirectory: string | undefined,
): Promise<string> {
	const resolvedInputPath = resolveCurrentLocalDataInputPath(
		context.currentDirectory,
		context.appDirectory,
		inputPath,
		"Current scorecard artifact",
	);
	const sourceArtifact = await loadEvaluationScorecardArtifact(
		basename(resolvedInputPath, ".json"),
		dirname(resolvedInputPath),
		artifactRoots(context),
	);
	if (sourceArtifact.version !== 3) {
		throw new EvaluationAggregateResultError(
			"unsupported_source_scorecard_version",
			resolvedInputPath,
			`Aggregate export requires a current local V3 scorecard artifact under ${context.localDataRoot}`,
		);
	}
	const outputDirectory = aggregateResultsDirectoryFor(context, resultsDirectory);
	const artifact = buildEvaluationAggregateResult(sourceArtifact, {
		id: safeEvaluationId("aggregate-result"),
		createdAt: new Date().toISOString(),
		cohortId,
	});
	await createEvaluationAggregateResultArtifact(artifact, outputDirectory);
	return formatEvaluationAggregateResultReport(
		await loadEvaluationAggregateResultArtifact(artifact.id, outputDirectory),
	);
}

export async function showEvaluationAggregateResultReportForCli(
	context: EvaluationLocalArtifactCliContext,
	aggregateId: string,
	resultsDirectory: string | undefined,
): Promise<string> {
	return formatEvaluationAggregateResultReport(
		await loadEvaluationAggregateResultArtifact(
			aggregateId,
			aggregateResultsDirectoryFor(context, resultsDirectory),
		),
	);
}

export async function compareEvaluationAggregateResultsForCli(
	context: EvaluationLocalArtifactCliContext,
	leftAggregateId: string,
	rightAggregateId: string,
	resultsDirectory: string | undefined,
): Promise<string> {
	const directory = aggregateResultsDirectoryFor(context, resultsDirectory);
	const left = await loadEvaluationAggregateResultArtifact(leftAggregateId, directory);
	const right = await loadEvaluationAggregateResultArtifact(rightAggregateId, directory);
	return formatEvaluationAggregateResultComparison(
		compareEvaluationAggregateResults(left, right),
	);
}

export async function buildEvaluationLongitudinalReportForCli(
	context: EvaluationLocalArtifactCliContext,
	inputPath: string,
	resultsDirectory: string | undefined,
): Promise<string> {
	const declarationPath = resolveCurrentLocalDataSourcePath(
		context.currentDirectory,
		context.appDirectory,
		inputPath,
		"Current longitudinal declaration",
	);
	const outputDirectory = longitudinalResultsDirectoryFor(context, resultsDirectory);
	await mkdir(outputDirectory, { recursive: true });
	const input = await loadEvaluationLongitudinalInput(declarationPath, context.localDataRoot);
	const artifact = buildEvaluationLongitudinalScorecard(input, {
		id: safeEvaluationId("longitudinal-scorecard"),
		createdAt: new Date().toISOString(),
	});
	await createEvaluationLongitudinalScorecardArtifact(
		join(outputDirectory, `${artifact.id}.json`),
		artifact,
		artifactRoots(context),
	);
	const saved = await loadEvaluationLongitudinalScorecardArtifact(
		artifact.id,
		outputDirectory,
		artifactRoots(context),
	);
	return formatEvaluationLongitudinalScorecardReport(
		saved,
		await longitudinalReportFreshness(saved, context.repositoryRoot),
	);
}

export async function showEvaluationLongitudinalReportForCli(
	context: EvaluationLocalArtifactCliContext,
	seriesId: string,
	resultsDirectory: string | undefined,
): Promise<string> {
	const saved = await loadEvaluationLongitudinalScorecardArtifact(
		seriesId,
		longitudinalShowResultsDirectoryFor(context, resultsDirectory),
		artifactRoots(context),
	);
	return formatEvaluationLongitudinalScorecardReport(
		saved,
		await longitudinalReportFreshness(saved, context.repositoryRoot),
	);
}
