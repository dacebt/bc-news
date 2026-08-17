import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildEvaluationAggregateResult } from "./evaluation-aggregate-result-builder";
import { runEvalCliApplication } from "./cli";
import {
	createEvaluationAggregateResultArtifact,
	loadEvaluationAggregateResultArtifact,
} from "./evaluation-aggregate-result-store";
import { buildEvaluationScorecard } from "./evaluation-scorecard-builder";
import { loadEvaluationScorecardInput } from "./evaluation-scorecard-input";
import { createEvaluationScorecardArtifact } from "./evaluation-scorecard-store";
import {
	buildControlledEvaluationScorecardInput,
	initializeControlledEvaluationRepository,
} from "./evaluation-scorecard-verifier";

function assertProof(condition: boolean, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function json(value: object): string {
	return `${JSON.stringify(value, null, 2)}\n`;
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

export async function verifyEvaluationAggregateResults(temporaryRoot?: string): Promise<string> {
	const root = temporaryRoot ?? await mkdtemp(join(tmpdir(), "bc-news-evaluation-aggregate-results-"));
	const cleanup = temporaryRoot === undefined;
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
		const scorecardCliPath = relative(repositoryRoot, scorecardPath);

		const exportOne = await invokeCli(
			["aggregate", "export", "--input", scorecardCliPath, "--cohort", scorecard.corpus.id],
			repositoryRoot,
			appDirectory,
		);
		const aggregateOneId = exportOne.match(/Evaluation aggregate result v1: ([^\n]+)/u)?.[1];
		assertProof(aggregateOneId !== undefined, "Aggregate export did not report its generated id");
		assertProof(exportOne.includes(`Cohort: id=${scorecard.corpus.id}`), "Aggregate export omitted the bound cohort id");
		assertProof(!exportOne.includes("source_reference") && !exportOne.includes("supporting_witnesses"), "Aggregate export reported forbidden retained evidence");

		let mismatchedRejected = false;
		try {
			await invokeCli(
				["aggregate", "export", "--input", scorecardCliPath, "--cohort", "baseline-b"],
				repositoryRoot,
				appDirectory,
			);
		} catch (error) {
			mismatchedRejected = error instanceof Error
				&& error.message.includes("Aggregate cohort id must match source scorecard corpus id");
		}
		assertProof(mismatchedRejected, "Aggregate export accepted a cohort id that did not match the source scorecard corpus id");

		const aggregateTwo = buildEvaluationAggregateResult(scorecard, {
			id: "aggregate-two",
			createdAt: controlled.createdAt,
			cohortId: scorecard.corpus.id,
			rawMessageCount: 7,
		});
		await createEvaluationAggregateResultArtifact(aggregateTwo, summariesDirectory(appDirectory));
		const aggregateTwoId = aggregateTwo.id;

		const aggregateResultsDirectory = summariesDirectory(appDirectory);
		const storedNames = (await readdir(aggregateResultsDirectory)).filter((name) => name.endsWith(".json"));
		assertProof(storedNames.length === 2, "Aggregate export did not create the default summaries artifacts");
		const aggregateOne = await loadEvaluationAggregateResultArtifact(aggregateOneId, aggregateResultsDirectory);
		assertProof(aggregateOne.cohort.id === scorecard.corpus.id, "Stored aggregate omitted the bound cohort id");

		const storedJson = await readFile(join(aggregateResultsDirectory, `${aggregateOne.id}.json`), "utf8");
		for (const forbidden of ["source_reference", "supporting_witnesses", "annotation_id", "review_id", "gateway_request_sha256"]) {
			assertProof(!storedJson.includes(forbidden), `Aggregate artifact retained forbidden field ${forbidden}`);
		}

		const showOutput = await invokeCli(
			["aggregate", "show", aggregateOneId],
			repositoryRoot,
			appDirectory,
		);
		assertProof(showOutput.includes(`Evaluation aggregate result v1: ${aggregateOneId}`), "Aggregate show did not render the stored aggregate");
		assertProof(showOutput.includes("Evidence retention: local_only"), "Aggregate show omitted the retention boundary");

		const compareOutput = await invokeCli(
			["aggregate", "compare", aggregateOneId, aggregateTwoId],
			repositoryRoot,
			appDirectory,
		);
		assertProof(compareOutput.includes(`Left aggregate result: ${aggregateOneId}`), "Aggregate compare omitted the left identity");
		assertProof(compareOutput.includes(`Right aggregate result: ${aggregateTwoId}`), "Aggregate compare omitted the right identity");
		assertProof(compareOutput.includes("- aggregate.cohort.raw_message_count"), "Aggregate compare did not report the numeric aggregate delta");

		await expectExclusiveCreate(aggregateOne, aggregateResultsDirectory);
		await expectFilenameMismatch(aggregateOne, aggregateResultsDirectory);
		await expectStrictForbiddenInjection(aggregateOne, aggregateResultsDirectory);

		return `${showOutput.trimEnd()}\nEVALUATION AGGREGATE RESULTS VERIFIED`;
	} finally {
		if (cleanup) await rm(root, { recursive: true, force: true });
	}
}

async function expectExclusiveCreate(
	aggregate: Awaited<ReturnType<typeof loadEvaluationAggregateResultArtifact>>,
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
	aggregate: Awaited<ReturnType<typeof loadEvaluationAggregateResultArtifact>>,
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
	aggregate: Awaited<ReturnType<typeof loadEvaluationAggregateResultArtifact>>,
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

function summariesDirectory(appDirectory: string): string {
	return join(appDirectory, "summaries");
}
