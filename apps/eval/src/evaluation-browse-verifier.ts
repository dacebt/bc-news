import { isDeepStrictEqual } from "node:util";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRODUCTION_MODEL_STEPS, type ProductionModelStep } from "@bc-news/generation-core";
import { RecordedModelResponseSchema } from "@bc-news/fixtures";
import { REPRESENTATIVE_FIXTURE_PATH } from "./representative-fixture";
import { runEvalCliApplication } from "./cli";
import { BenchmarkRunSchema, type BenchmarkRun } from "./evaluation-artifact";
import { BenchmarkRunReadError } from "./evaluation-artifact-reader";
import { summarizeBenchmarkRun } from "./evaluation-browse-report";
import { evaluateBenchmarkCommand } from "./evaluation-benchmark-command";
import { compareBenchmarkRuns } from "./evaluation-comparison";
import { projectBenchmarkBehavior } from "./evaluation-observation";
import { startRecordLoopbackServer } from "./record-loopback-server";

const RESPONSE_DIRECTORY = new URL("../../../packages/fixtures/model-responses/", import.meta.url).pathname;
const FIRST_PROVENANCE = {
	repository: "bc-news" as const,
	commit_sha: "3333333333333333333333333333333333333333",
	dirty: false as const,
};
const SECOND_PROVENANCE = {
	...FIRST_PROVENANCE,
	commit_sha: "4444444444444444444444444444444444444444",
};

export class EvaluationBrowseVerificationError extends Error {
	readonly code: string;
	constructor(code: string, message: string) {
		super(message);
		this.name = "EvaluationBrowseVerificationError";
		this.code = code;
	}
}

function assertProof(condition: boolean, code: string, message: string): asserts condition {
	if (!condition) throw new EvaluationBrowseVerificationError(code, message);
}

function productionConfiguration(modelPrefix: string) {
	return {
		production_steps: Object.fromEntries(PRODUCTION_MODEL_STEPS.map((step) => [step, {
			adapter: "openai_compatible_hosted",
			provider: "repository_loopback",
			model: `${modelPrefix}/${step}`,
			billing: {
				method: "calculated",
				input_usd_per_million_tokens: 0,
				output_usd_per_million_tokens: 0,
				pricing_reference: "repository browse proof",
			},
		}])) as Record<ProductionModelStep, unknown>,
	};
}

function benchmarkConfig() {
	return {
		configurations: [productionConfiguration("browse-a"), productionConfiguration("browse-b")],
		repetition_count: 1,
		transport_retry_limit: 1,
	};
}

async function retainedOutputs(): Promise<Record<string, string>> {
	const entries = await Promise.all(PRODUCTION_MODEL_STEPS.map(async (step) => {
		const input = JSON.parse(await readFile(join(RESPONSE_DIRECTORY, `${step}.json`), "utf8")) as unknown;
		const output = RecordedModelResponseSchema.parse(input).text;
		return [[`browse-a/${step}`, output], [`browse-b/${step}`, output]] as const;
	}));
	return Object.fromEntries(entries.flatMap((entry) => entry));
}

function withArtifactIdentity(run: BenchmarkRun, id: string, startedAt: string, commitProvenance = SECOND_PROVENANCE): BenchmarkRun {
	return BenchmarkRunSchema.parse({
		...structuredClone(run),
		id,
		started_at: startedAt,
		provenance: { ...structuredClone(run.provenance), code: commitProvenance },
	});
}

function withCompletionChange(run: BenchmarkRun): BenchmarkRun {
	const changed = structuredClone(run);
	const succeeded = changed.trials.flatMap(({ invocations }) => invocations).find(
		(invocation) => invocation.transport === "succeeded",
	);
	assertProof(succeeded?.transport === "succeeded", "completion_missing", "Browse proof found no retained completion");
	assertProof(
		succeeded.completion.token_usage.measurement === "reported",
		"usage_missing",
		"Browse proof completion has no reported usage",
	);
	succeeded.completion.token_usage.input_tokens += 1;
	succeeded.completion.token_usage.total_tokens += 1;
	return BenchmarkRunSchema.parse(changed);
}

async function invokeCli(
	argv: readonly string[],
	currentDirectory: string,
	initDirectory: string,
	appDirectory: string,
): Promise<string> {
	let output = "";
	await runEvalCliApplication({
		argv,
		currentDirectory,
		appDirectory,
		environment: { INIT_CWD: initDirectory },
		writeOutput: (text) => { output += text; },
	});
	return output;
}

async function assertRejected(
	operation: () => Promise<unknown>,
	code: BenchmarkRunReadError["code"],
): Promise<void> {
	try {
		await operation();
	} catch (error) {
		assertProof(error instanceof BenchmarkRunReadError, "wrong_read_error", "Untrustworthy evidence did not produce the typed read error");
		assertProof(error.code === code, "wrong_read_error_code", `Expected ${code}, received ${error.code}`);
		return;
	}
	throw new EvaluationBrowseVerificationError("untrustworthy_evidence_read", `Untrustworthy evidence was read without ${code}`);
}

export async function verifyEvaluationBenchmarkBrowsing(temporaryRoot?: string): Promise<void> {
	const root = temporaryRoot ?? await mkdtemp(join(tmpdir(), "bc-news-evaluation-browse-"));
	const appDirectory = join(root, "app");
	const defaultDirectory = join(appDirectory, "evaluation-results");
	const invocationDirectory = join(root, "invocation");
	const currentDirectory = join(root, "different-current-directory");
	const explicitDirectory = join(invocationDirectory, "custom-results");
	await Promise.all([
		mkdir(defaultDirectory, { recursive: true }),
		mkdir(explicitDirectory, { recursive: true }),
	]);
	const configPath = join(root, "browse.config.json");
	await writeFile(configPath, `${JSON.stringify(benchmarkConfig(), null, 2)}\n`, "utf8");
	const server = await startRecordLoopbackServer(await retainedOutputs());
	try {
		const result = await evaluateBenchmarkCommand({
			fixturePath: REPRESENTATIVE_FIXTURE_PATH,
			configPath,
			resultsDirectory: defaultDirectory,
			environment: {
				HOSTED_MODEL_BASE_URL: server.baseUrl,
				HOSTED_MODEL_API_KEY: "record-loopback-proof",
			},
			sourceProvenance: FIRST_PROVENANCE,
		});
		const evaluated = BenchmarkRunSchema.parse(result.benchmark);
		assertProof(evaluated.version === 7, "current_artifact_version", "Browse proof did not produce current artifact version 7");
		await unlink(result.path);
		const newer = withArtifactIdentity(evaluated, "a-chronologically-newer", evaluated.started_at);
		const older = withArtifactIdentity(
			evaluated,
			"z-lexically-newer-but-older",
			new Date(Date.parse(evaluated.started_at) - 1).toISOString(),
			FIRST_PROVENANCE,
		);
		await Promise.all([
			writeFile(join(defaultDirectory, `${newer.id}.json`), `${JSON.stringify(newer, null, 2)}\n`, "utf8"),
			writeFile(join(defaultDirectory, `${older.id}.json`), `${JSON.stringify(older, null, 2)}\n`, "utf8"),
			writeFile(join(explicitDirectory, `${newer.id}.json`), `${JSON.stringify(newer, null, 2)}\n`, "utf8"),
			writeFile(join(explicitDirectory, `${older.id}.json`), `${JSON.stringify(older, null, 2)}\n`, "utf8"),
		]);

		const comparison = compareBenchmarkRuns(older, newer);
		assertProof(isDeepStrictEqual(projectBenchmarkBehavior(older), projectBenchmarkBehavior(newer)), "volatile_behavior_drift", "Artifact identity or timestamp changed the behavioral projection");
		assertProof(comparison.behavioralDifferences.length === 0, "volatile_difference_reported", "Equivalent behavior produced behavioral differences");
		assertProof(comparison.contextDifferences.some((path) => path.endsWith("provenance.code.commit_sha")), "commit_context_missing", "Commit-only drift was not reported in context differences");
		assertProof(compareBenchmarkRuns(older, withCompletionChange(older)).behavioralDifferences.some((path) => path.includes("completion.token_usage")), "completion_behavior_missing", "Completion evidence change was not reported as behavioral");

		const listOutput = await invokeCli(["benchmark", "list"], currentDirectory, invocationDirectory, appDirectory);
		assertProof(listOutput.includes(older.id) && listOutput.includes(newer.id), "list_route_missing", "Default benchmark list omitted retained runs");
		assertProof(listOutput.indexOf(newer.id) < listOutput.indexOf(older.id), "list_order_wrong", "Benchmark list did not sort parsed start time before lexical id order");
		const showOutput = await invokeCli(["benchmark", "show", older.id, "--results-dir", "custom-results"], currentDirectory, invocationDirectory, appDirectory);
		assertProof(BenchmarkRunSchema.safeParse(JSON.parse(showOutput) as unknown).success, "show_route_invalid", "Explicit-directory benchmark show did not emit the complete strict artifact");
		const summary = summarizeBenchmarkRun(older);
		assertProof(summary.trials.length === 2, "summary_trial_attribution_missing", "Multi-configuration summary omitted retained trials");
		assertProof(summary.trials.every((trial) => "diagnostics" in trial.tracks.main_story && "diagnostics" in trial.tracks.announcements), "summary_diagnostics_missing", "Benchmark summary omitted track diagnostic details");
		assertProof(summary.trials.every((trial, index) => trial.ordinal === index + 1
			&& trial.configuration_ordinal === index + 1
			&& trial.configuration_identity === older.declaration.configurations[index]?.identity
			&& trial.repetition === 1
			&& trial.subject_outcome === older.trials[index]?.subject_outcome
			&& trial.tracks.main_story.subject_outcome === older.trials[index]?.tracks.main_story.subject_outcome
			&& trial.tracks.announcements.subject_outcome === older.trials[index]?.tracks.announcements.subject_outcome), "summary_trial_attribution_wrong", "Summary did not attribute trial and track outcomes to the declared configuration roster");
		const summaryOutput = await invokeCli(["benchmark", "summary", older.id], currentDirectory, invocationDirectory, appDirectory);
		const emittedSummary = JSON.parse(summaryOutput) as { trials?: unknown[] };
		assertProof(summaryOutput.includes('"products"') && summaryOutput.includes('"invocations"') && emittedSummary.trials?.length === 2, "summary_route_incomplete", "Benchmark summary omitted per-trial attribution, product, or invocation evidence");
		const compareOutput = await invokeCli(["benchmark", "compare", older.id, newer.id, "--results-dir", "custom-results"], currentDirectory, invocationDirectory, appDirectory);
		assertProof(compareOutput.includes("Behavioral differences: none") && compareOutput.includes("provenance.code.commit_sha"), "compare_route_incomplete", "Benchmark comparison did not separate context and behavioral differences");

		const corruptPath = join(defaultDirectory, "corrupt.json");
		await writeFile(corruptPath, "{not-json\n", "utf8");
		await assertRejected(
			() => invokeCli(["benchmark", "list"], currentDirectory, invocationDirectory, appDirectory),
			"benchmark_artifact_malformed",
		);
		await unlink(corruptPath);
		const mismatchPath = join(defaultDirectory, "filename-mismatch.json");
		await writeFile(mismatchPath, `${JSON.stringify(older)}\n`, "utf8");
		await assertRejected(
			() => invokeCli(["benchmark", "show", "filename-mismatch"], currentDirectory, invocationDirectory, appDirectory),
			"benchmark_filename_mismatch",
		);
	} finally {
		await server.close();
		if (temporaryRoot === undefined) await rm(root, { recursive: true, force: true });
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	verifyEvaluationBenchmarkBrowsing().then(() => {
		console.log("evaluation: evidence listed summarized and compared without verdicts");
	}).catch((error: unknown) => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}
