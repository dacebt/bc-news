import { isDeepStrictEqual } from "node:util";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRODUCTION_MODEL_STEPS, type ProductionModelStep } from "@bc-news/generation-core";
import { RecordedModelResponseSchema } from "@bc-news/fixtures";
import { CANONICAL_FIXTURE_PATH } from "./canonical-walk-verifier";
import { evaluateBenchmarkCommand } from "./evaluation-benchmark-command";
import { BenchmarkRunSchema, type BenchmarkRun, type V2BenchmarkRun } from "./evaluation-artifact";
import { startRecordLoopbackServer } from "./record-loopback-server";

const RESPONSE_DIRECTORY = new URL("../../../packages/fixtures/model-responses/", import.meta.url).pathname;
const TEST_PROVENANCE = { repository: "bc-news" as const, commit_sha: "2222222222222222222222222222222222222222", dirty: false as const };

const CONFIGURATIONS = ["retry_success", "provider_exhausted", "model_rejected", "later_completed"] as const;
type Scenario = (typeof CONFIGURATIONS)[number];

export class EvaluationBenchmarkVerificationError extends Error {
	readonly code: string;
	constructor(code: string, message: string) { super(message); this.name = "EvaluationBenchmarkVerificationError"; this.code = code; }
}

function assertProof(condition: boolean, code: string, message: string): asserts condition {
	if (!condition) throw new EvaluationBenchmarkVerificationError(code, message);
}

function modelFor(scenario: Scenario, step: ProductionModelStep): string { return `benchmark/${scenario}/${step}`; }

function benchmarkConfig() {
	return {
		configurations: CONFIGURATIONS.map((scenario) => ({
			production_steps: Object.fromEntries(PRODUCTION_MODEL_STEPS.map((step) => [step, {
				adapter: "openai_compatible_hosted",
				provider: "repository_loopback",
				model: modelFor(scenario, step),
				billing: { method: "calculated", input_usd_per_million_tokens: 0, output_usd_per_million_tokens: 0, pricing_reference: "repository benchmark proof" },
			}])) as Record<ProductionModelStep, unknown>,
		})),
		repetition_count: 1,
		transport_retry_limit: 1,
	};
}

async function retainedOutputs(): Promise<Record<ProductionModelStep, string>> {
	return Object.fromEntries(await Promise.all(PRODUCTION_MODEL_STEPS.map(async (step) => {
		const parsed = RecordedModelResponseSchema.parse(JSON.parse(await readFile(join(RESPONSE_DIRECTORY, `${step}.json`), "utf8")) as unknown);
		return [step, parsed.text];
	}))) as Record<ProductionModelStep, string>;
}

function assertSnapshots(snapshots: readonly BenchmarkRun[]): void {
	assertProof(snapshots.length > 0, "snapshots_missing", "Benchmark observer retained no incremental snapshots");
	for (const snapshot of snapshots) assertProof(BenchmarkRunSchema.safeParse(snapshot).success, "snapshot_invalid", "An incremental benchmark snapshot failed strict parsing");
	assertProof(snapshots.some((snapshot) => snapshot.version === 2 && snapshot.trials.some((trial) => trial.invocations.some(({ transport }) => transport === "in_flight"))), "in_flight_not_observed", "No pre-transport invocation snapshot was retained");
	assertProof(snapshots.some((snapshot) => snapshot.version === 2 && snapshot.trials.some((trial) => trial.invocations.some((invocation) => invocation.transport === "failed" && invocation.retry_classification.state === "classified"))), "classified_failure_not_observed", "No classified failed invocation snapshot was retained");
}

function assertFinalBenchmark(benchmark: V2BenchmarkRun): void {
	assertProof(benchmark.lifecycle === "complete" && benchmark.harness_outcome === "retained", "benchmark_not_retained", "Serial benchmark did not close as retained");
	assertProof(benchmark.trials.length === CONFIGURATIONS.length, "later_trials_missing", "Serial benchmark did not retain every declared trial");
	assertProof(isDeepStrictEqual(benchmark.trial_roster.map(({ trial_id, config_identity, repetition }) => ({ trial_id, config_identity, repetition })), benchmark.trials.map(({ id, config_identity, repetition }) => ({ trial_id: id, config_identity, repetition }))), "roster_order_mismatch", "Retained trials did not follow the exact roster order");

	const [retryTrial, exhaustedTrial, rejectedTrial, laterTrial] = benchmark.trials;
	assertProof(retryTrial !== undefined && exhaustedTrial !== undefined && rejectedTrial !== undefined && laterTrial !== undefined, "trial_roster_incomplete", "Expected four scenario trials");
	const retryInvocations = retryTrial.invocations.filter(({ production_step }) => production_step === "main_story_write");
	assertProof(retryInvocations.length === 2, "retry_count_mismatch", "Transient failure did not retain exactly one retry");
	const [failed, succeeded] = retryInvocations;
	assertProof(failed?.transport === "failed" && failed.retry_classification.state === "classified" && failed.retry_classification.eligible, "retry_predecessor_not_eligible", "Retry predecessor was not a retained eligible transport failure");
	assertProof(succeeded?.transport === "succeeded" && succeeded.predecessor_invocation_id === failed.id, "retry_link_mismatch", "Retry did not link to its immediate failed predecessor");
	assertProof(isDeepStrictEqual(succeeded.request, failed.request) && succeeded.request_sha256 === failed.request_sha256, "retry_request_changed", "Retry request evidence changed across attempts");

	assertProof(exhaustedTrial.subject_outcome === "infrastructure_incomplete", "provider_exhaustion_outcome", "Provider exhaustion did not close the trial as infrastructure-incomplete");
	assertProof(exhaustedTrial.tracks.main_story.subject_outcome === "infrastructure_incomplete", "provider_exhaustion_track", "Provider exhaustion did not isolate to the main-story track");
	const exhaustedInvocations = exhaustedTrial.invocations.filter(({ production_step }) => production_step === "main_story_write");
	assertProof(exhaustedInvocations.length === benchmark.declaration.transport_retry_limit + 1, "provider_exhaustion_attempts", "Provider exhaustion did not consume the declared retry limit");
	assertProof(exhaustedInvocations.every((invocation) => invocation.transport === "failed" && invocation.retry_classification.state === "classified" && invocation.retry_classification.eligible), "provider_exhaustion_evidence", "Provider exhaustion did not retain only classified eligible failures");
	assertProof(exhaustedTrial.tracks.announcements.lifecycle === "completed", "independent_track_suppressed", "Provider exhaustion suppressed the independent announcements track");
	assertProof(rejectedTrial.subject_outcome === "parse_rejected", "model_rejection_missing", "Model-level invalid JSON was not retained as a rejected trial");
	assertProof(laterTrial.subject_outcome === "completed", "later_trial_not_completed", "A later declared trial did not run to completion after prior failures");
	assertProof(benchmark.outcome_counts.completed === 2 && benchmark.outcome_counts.infrastructure_incomplete === 1 && benchmark.outcome_counts.parse_rejected === 1, "outcome_counts_mismatch", "Benchmark outcome counts did not match retained trials");
}

export async function verifyEvaluationBenchmarkContinuation(temporaryRoot?: string): Promise<void> {
	const root = temporaryRoot ?? await mkdtemp(join(tmpdir(), "bc-news-evaluation-benchmark-"));
	await mkdir(root, { recursive: true });
	const configPath = join(root, "serial-benchmark.config.json");
	const resultsDirectory = join(root, "results");
	await writeFile(configPath, `${JSON.stringify(benchmarkConfig(), null, 2)}\n`, "utf8");
	const outputs = await retainedOutputs();
	const outputByModel = Object.fromEntries(CONFIGURATIONS.flatMap((scenario) => PRODUCTION_MODEL_STEPS.map((step) => [modelFor(scenario, step), scenario === "model_rejected" && step === "main_story_write" ? "not json" : outputs[step]])));
	const transientModel = modelFor("retry_success", "main_story_write");
	const exhaustedModel = modelFor("provider_exhausted", "main_story_write");
	const server = await startRecordLoopbackServer(outputByModel, {
		transientFailureModels: new Set([transientModel]),
		retryableFailureModels: new Set([exhaustedModel]),
	});
	const snapshots: BenchmarkRun[] = [];
	try {
		const result = await evaluateBenchmarkCommand({
			fixturePath: CANONICAL_FIXTURE_PATH,
			configPath,
			resultsDirectory,
			environment: { HOSTED_MODEL_BASE_URL: server.baseUrl, HOSTED_MODEL_API_KEY: "record-loopback-proof" },
			sourceProvenance: TEST_PROVENANCE,
			artifactObserver: (artifact) => { snapshots.push(structuredClone(artifact)); },
		});
		assertSnapshots(snapshots);
		assertFinalBenchmark(result.benchmark);
		const retained = BenchmarkRunSchema.parse(JSON.parse(await readFile(result.path, "utf8")) as unknown);
		assertProof(retained.version === 2 && isDeepStrictEqual(retained, result.benchmark), "retained_artifact_mismatch", "Returned benchmark did not equal its retained artifact");
	} finally {
		await server.close();
		if (temporaryRoot === undefined) await rm(root, { recursive: true, force: true });
	}
	console.log("walk: serial evaluation benchmark retained linked retries and continued later trials");
}

if (import.meta.url === `file://${process.argv[1]}`) {
	verifyEvaluationBenchmarkContinuation().catch((error: unknown) => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}
