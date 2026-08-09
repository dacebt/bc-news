import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRODUCTION_MODEL_STEPS, type ProductionModelStep } from "@bc-news/generation-core";
import { RecordedModelResponseSchema } from "@bc-news/fixtures";
import { BenchmarkRunSchema, evaluationOutputContractProvenance, type BenchmarkRun } from "./evaluation-artifact";
import { REPRESENTATIVE_FIXTURE_PATH } from "./representative-fixture";
import { evaluateTrialCommand } from "./evaluation-trial-command";
import { startRecordLoopbackServer } from "./record-loopback-server";

const RESPONSE_DIRECTORY = new URL("../../../packages/fixtures/model-responses/", import.meta.url).pathname;
const VERIFIER_SOURCE_PROVENANCE = {
	repository: "bc-news" as const,
	commit_sha: "1111111111111111111111111111111111111111",
	dirty: false as const,
};

class EvaluationTrialVerificationError extends Error {
	constructor(readonly code: string, message: string) {
		super(message);
		this.name = "EvaluationTrialVerificationError";
	}
}

function assertProof(condition: boolean, code: string, message: string): asserts condition {
	if (!condition) throw new EvaluationTrialVerificationError(code, message);
}

function asError(value: unknown): Error {
	return value instanceof Error ? value : new Error(String(value));
}

async function retainedOutputs(): Promise<Record<ProductionModelStep, string>> {
	return Object.fromEntries(await Promise.all(PRODUCTION_MODEL_STEPS.map(async (step) => {
		const parsed = RecordedModelResponseSchema.parse(JSON.parse(await readFile(join(RESPONSE_DIRECTORY, `${step}.json`), "utf8")) as unknown);
		return [step, parsed.text];
	}))) as Record<ProductionModelStep, string>;
}

function liveConfig(modelPrefix: string) {
	return {
		production_steps: Object.fromEntries(PRODUCTION_MODEL_STEPS.map((step) => [step, {
			adapter: "openai_compatible_hosted",
			provider: "repository_loopback",
			model: `${modelPrefix}/${step}`,
			billing: {
				method: "calculated",
				input_usd_per_million_tokens: 0,
				output_usd_per_million_tokens: 0,
				pricing_reference: "repository loopback retention proof",
			},
		}])),
	};
}

async function diskAuthoritativeObserver(resultsDirectory: string, states: BenchmarkRun[], notified: BenchmarkRun): Promise<void> {
	const retained = BenchmarkRunSchema.parse(JSON.parse(await readFile(join(resultsDirectory, `${notified.id}.json`), "utf8")) as unknown);
	assertProof(JSON.stringify(retained) === JSON.stringify(notified), "observer_preceded_durability", "Artifact observer notification did not match durable bytes");
	states.push(retained);
}

function assertTransportFailureSequence(states: readonly BenchmarkRun[]): void {
	const terminal = states.at(-1);
	assertProof(terminal !== undefined, "missing_failure_terminal", "Transport-failure trial retained no states");
	const invocation = terminal.trials[0]!.invocations.find(({ production_step }) => production_step === "main_story_write");
	assertProof(invocation?.transport === "failed" && invocation.retry_classification.state === "classified", "failure_not_classified", "Main-story transport failure was not terminally classified");
	assertProof(invocation.retry_classification.eligible && invocation.retry_classification.reason.length > 0, "failure_not_retryable", "503 failure was not classified eligible with a reason");
	const inFlight = states.findIndex((state) => state.trials[0]!.invocations.some((item) => item.id === invocation.id && item.transport === "in_flight"));
	const pending = states.findIndex((state) => state.trials[0]!.invocations.some((item) => item.id === invocation.id && item.transport === "failed" && item.retry_classification.state === "pending"));
	const classified = states.findIndex((state) => state.trials[0]!.invocations.some((item) => item.id === invocation.id && item.transport === "failed" && item.retry_classification.state === "classified"));
	assertProof(inFlight >= 0 && pending > inFlight && classified > pending, "failure_sequence_invalid", "Transport failure was not durably retained in flight, pending classification, then classified");
}

function sha256Json(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function assertPersistenceSequence(states: readonly BenchmarkRun[]): void {
	const terminal = states.at(-1);
	assertProof(terminal !== undefined, "missing_terminal_state", "Trial did not retain any artifact states");
	for (const invocation of terminal.trials[0]!.invocations) {
		assertProof(invocation.request_sha256 === sha256Json(invocation.request), "request_hash_mismatch", `${invocation.id} request hash did not bind its exact retained request`);
		const inFlightIndex = states.findIndex((state) => state.trials[0]!.invocations.some((candidate) => candidate.id === invocation.id && candidate.transport === "in_flight"));
		const preParseIndex = states.findIndex((state) => state.trials[0]!.invocations.some((candidate) => candidate.id === invocation.id && candidate.transport === "succeeded" && candidate.parse.state === "pending"));
		assertProof(inFlightIndex >= 0, "in_flight_not_retained", `${invocation.id} was not retained before transport`);
		assertProof(preParseIndex > inFlightIndex, "pre_parse_not_retained", `${invocation.id} completion was not retained before parsing`);
	}
}

async function parseEverySavedArtifact(resultsDirectory: string): Promise<BenchmarkRun[]> {
	const names = (await readdir(resultsDirectory)).filter((name) => name.endsWith(".json"));
	return Promise.all(names.map(async (name) => BenchmarkRunSchema.parse(JSON.parse(await readFile(join(resultsDirectory, name), "utf8")) as unknown)));
}

export async function verifyEvaluationTrialRetention(): Promise<void> {
	const temporaryRoot = await mkdtemp(join(tmpdir(), "bc-news-evaluation-trial-retention-"));
	const completeResults = join(temporaryRoot, "complete-results");
	const diagnosticResults = join(temporaryRoot, "diagnostic-results");
	const contractResults = join(temporaryRoot, "contract-results");
	const failureResults = join(temporaryRoot, "failure-results");
	const mixedResults = join(temporaryRoot, "mixed-results");
	const completeConfigPath = join(temporaryRoot, "complete.config.json");
	const diagnosticConfigPath = join(temporaryRoot, "diagnostic.config.json");
	const contractConfigPath = join(temporaryRoot, "contract.config.json");
	const failureConfigPath = join(temporaryRoot, "failure.config.json");
	const mixedConfigPath = join(temporaryRoot, "mixed.config.json");
	await writeFile(completeConfigPath, `${JSON.stringify(liveConfig("complete"), null, 2)}\n`, "utf8");
	await writeFile(diagnosticConfigPath, `${JSON.stringify(liveConfig("diagnostic"), null, 2)}\n`, "utf8");
	await writeFile(contractConfigPath, `${JSON.stringify(liveConfig("contract"), null, 2)}\n`, "utf8");
	await writeFile(failureConfigPath, `${JSON.stringify(liveConfig("failure"), null, 2)}\n`, "utf8");
	await writeFile(mixedConfigPath, `${JSON.stringify(liveConfig("mixed"), null, 2)}\n`, "utf8");

	const outputs = await retainedOutputs();
	const retainedMainCopyedit = JSON.parse(outputs.main_story_copyedit) as {
		title: string;
		subtitle: string;
		main_story: { headline: string; lede: string; body: string };
	};
	const diagnosticMainCopyedit = JSON.stringify({
		...retainedMainCopyedit,
		main_story: {
			...retainedMainCopyedit.main_story,
			body: "**Mallory** summarized “invented words”—system prompt.",
		},
	});
	const contractInvalidMainCopyedit = JSON.stringify({ ...retainedMainCopyedit, invented: true });
	const outputByModel: Record<string, string> = {};
	for (const step of PRODUCTION_MODEL_STEPS) {
		outputByModel[`complete/${step}`] = outputs[step];
		outputByModel[`diagnostic/${step}`] = step === "main_story_copyedit"
			? diagnosticMainCopyedit
			: outputs[step];
		outputByModel[`failure/${step}`] = outputs[step];
		outputByModel[`contract/${step}`] = step === "main_story_copyedit" ? contractInvalidMainCopyedit : outputs[step];
		outputByModel[`mixed/${step}`] = step === "main_story_copyedit"
			? diagnosticMainCopyedit
			: step === "announcements_write"
				? "not json"
				: outputs[step];
	}
	let primaryFailure: unknown;
	let server: Awaited<ReturnType<typeof startRecordLoopbackServer>> | undefined;
	try {
		server = await startRecordLoopbackServer(outputByModel, { retryableFailureModels: new Set(["failure/main_story_write"]) });
		const environment = {
			HOSTED_MODEL_BASE_URL: server.baseUrl,
			HOSTED_MODEL_API_KEY: "record-loopback-proof",
		};
		const completeStates: BenchmarkRun[] = [];
		const completed = await evaluateTrialCommand({
			fixturePath: REPRESENTATIVE_FIXTURE_PATH,
			configPath: completeConfigPath,
			resultsDirectory: completeResults,
			environment,
			artifactObserver: (artifact) => diskAuthoritativeObserver(completeResults, completeStates, artifact),
			sourceProvenance: VERIFIER_SOURCE_PROVENANCE,
		});
		const diagnosticStates: BenchmarkRun[] = [];
		const diagnostic = await evaluateTrialCommand({
			fixturePath: REPRESENTATIVE_FIXTURE_PATH,
			configPath: diagnosticConfigPath,
			resultsDirectory: diagnosticResults,
			environment,
			artifactObserver: (artifact) => diskAuthoritativeObserver(diagnosticResults, diagnosticStates, artifact),
			sourceProvenance: VERIFIER_SOURCE_PROVENANCE,
		});
		const failureStates: BenchmarkRun[] = [];
		const contractStates: BenchmarkRun[] = [];
		const contractRejected = await evaluateTrialCommand({
			fixturePath: REPRESENTATIVE_FIXTURE_PATH,
			configPath: contractConfigPath,
			resultsDirectory: contractResults,
			environment,
			artifactObserver: (artifact) => diskAuthoritativeObserver(contractResults, contractStates, artifact),
			sourceProvenance: VERIFIER_SOURCE_PROVENANCE,
		});
		const failed = await evaluateTrialCommand({
			fixturePath: REPRESENTATIVE_FIXTURE_PATH,
			configPath: failureConfigPath,
			resultsDirectory: failureResults,
			environment,
			artifactObserver: (artifact) => diskAuthoritativeObserver(failureResults, failureStates, artifact),
			sourceProvenance: VERIFIER_SOURCE_PROVENANCE,
		});
		const mixedStates: BenchmarkRun[] = [];
		const mixed = await evaluateTrialCommand({
			fixturePath: REPRESENTATIVE_FIXTURE_PATH,
			configPath: mixedConfigPath,
			resultsDirectory: mixedResults,
			environment,
			artifactObserver: (artifact) => diskAuthoritativeObserver(mixedResults, mixedStates, artifact),
			sourceProvenance: VERIFIER_SOURCE_PROVENANCE,
		});

		assertProof(completed.benchmark.trials[0]!.subject_outcome === "completed", "complete_trial_not_completed", "Controlled complete trial did not complete");
		const diagnosticTrack = diagnostic.benchmark.trials[0]!.tracks.main_story;
		assertProof(diagnostic.benchmark.trials[0]!.subject_outcome === "completed", "diagnostic_trial_not_completed", "Schema-valid copyedit diagnostics changed the trial outcome");
		assertProof(diagnosticTrack.lifecycle === "completed" && diagnosticTrack.product !== null, "diagnostic_product_not_retained", "Schema-valid copyedit did not retain its completed product");
		assertProof(new Set(diagnosticTrack.findings.map(({ kind }) => kind)).size === 2, "diagnostic_categories_incomplete", "Preservation and final-product diagnostic categories were not both retained");
		assertProof(diagnostic.benchmark.trials[0]!.invocations.length === 4, "diagnostic_invocation_roster", "Diagnostics changed the one-writer one-copyedit invocation roster");
		assertProof(diagnostic.benchmark.trials[0]!.invocations.filter(({ production_step }) => production_step === "main_story_copyedit").length === 1, "diagnostic_copyedit_retried", "Diagnostics triggered another copyedit invocation");
		assertPersistenceSequence(completeStates);
		assertPersistenceSequence(diagnosticStates);
		assertPersistenceSequence(contractStates);
		assertProof(contractRejected.benchmark.trials[0]!.tracks.main_story.subject_outcome === "contract_rejected", "schema_mismatch_not_terminal", "Strict copyedit schema mismatch did not remain terminal");
		assertProof(contractRejected.benchmark.trials[0]!.selected_invocation_ids.main_story_copyedit === null, "schema_mismatch_selected", "Strict schema mismatch was selected as a usable copyedit");
		assertTransportFailureSequence(failureStates);
		assertProof(failed.benchmark.trials[0]!.subject_outcome === "infrastructure_incomplete", "failure_subject_outcome", "Transport failure did not produce infrastructure_incomplete");
		assertProof(failed.benchmark.trials[0]!.tracks.announcements.lifecycle === "completed", "failure_independent_track", "Transport failure suppressed announcements");
		assertProof(mixed.benchmark.trials[0]!.subject_outcome === "parse_rejected", "mixed_failure_precedence", "Aggregate outcome did not retain the independent malformed-JSON rejection");
		assertProof(mixed.benchmark.trials[0]!.tracks.main_story.subject_outcome === "completed" && mixed.benchmark.trials[0]!.tracks.main_story.findings.length > 1, "mixed_main_story_outcome", "Mixed trial lost the completed main-story diagnostics");
		assertProof(mixed.benchmark.trials[0]!.tracks.announcements.subject_outcome === "parse_rejected", "mixed_announcements_outcome", "Mixed trial lost the announcements parse rejection");
		assertProof(mixed.benchmark.trials[0]!.selected_invocation_ids.announcements_write === null, "malformed_json_selected", "Malformed writer JSON was selected as usable output");
		assertProof(mixed.benchmark.lifecycle === "complete" && mixed.benchmark.harness_outcome === "retained", "mixed_harness_outcome", "Mixed-failure trial was not terminally retained");
		assertPersistenceSequence(mixedStates);
		const saved = [...await parseEverySavedArtifact(completeResults), ...await parseEverySavedArtifact(diagnosticResults), ...await parseEverySavedArtifact(contractResults), ...await parseEverySavedArtifact(failureResults), ...await parseEverySavedArtifact(mixedResults)];
		assertProof(saved.length === 5, "saved_artifact_count", "Verifier did not retain exactly five terminal artifacts");
		assertProof(saved.every(({ version }) => version === 5), "current_artifact_version", "A newly generated trial did not retain current artifact version 5");
		assertProof(saved.every(({ lifecycle, harness_outcome }) => lifecycle === "complete" && harness_outcome === "retained"), "harness_outcome_not_retained", "A terminal artifact did not retain a successful harness outcome");
		assertProof(saved.every(({ provenance }) => JSON.stringify(provenance.output_contracts) === JSON.stringify(evaluationOutputContractProvenance())), "current_contract_provenance", "A newly generated artifact did not retain the current application output contracts and hashes");
	} catch (error: unknown) {
		primaryFailure = error;
	}
	let closeFailure: unknown;
	try { await server?.close(); }
	catch (error: unknown) { closeFailure = error; }
	let cleanupFailure: unknown;
	try { await rm(temporaryRoot, { recursive: true, force: true }); }
	catch (error: unknown) { cleanupFailure = error; }
	if (primaryFailure !== undefined) {
		const primaryError = asError(primaryFailure);
		if (closeFailure !== undefined || cleanupFailure !== undefined) {
			throw new AggregateError(
				[primaryError, ...[closeFailure, cleanupFailure].filter((value) => value !== undefined).map(asError)],
				`Evaluation verifier failed and cleanup was incomplete for ${temporaryRoot}`,
				{ cause: primaryError },
			);
		}
		throw primaryError;
	}
	if (closeFailure !== undefined || cleanupFailure !== undefined) {
		const cleanupErrors = [closeFailure, cleanupFailure].filter((value) => value !== undefined).map(asError);
		throw new AggregateError(cleanupErrors, `Evaluation verifier cleanup failed for ${temporaryRoot}`, {
			cause: cleanupErrors[0],
		});
	}
	process.stdout.write("evaluation: diagnostics, schema rejection, infrastructure failure, and completion retained incrementally\n");
}

void verifyEvaluationTrialRetention().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`evaluation trial retention failed: ${message}\n`);
	process.exitCode = 1;
});
