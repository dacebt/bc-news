import { isDeepStrictEqual } from "node:util";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRODUCTION_MODEL_STEPS, type ProductionModelStep } from "@bc-news/generation-core";
import { RecordedModelResponseSchema } from "@bc-news/fixtures";
import { evaluateTrialCommand } from "./evaluation-trial-command";
import {
	type BenchmarkRun,
	V9BenchmarkRunSchema,
	type V9BenchmarkRun,
} from "./evaluation-artifact";
import { loadBenchmarkRun } from "./evaluation-artifact-reader";
import { EvaluationArtifactStore } from "./evaluation-artifact-store";
import { summarizeBenchmarkRun } from "./evaluation-browse-report";
import { compareBenchmarkRuns } from "./evaluation-comparison";
import { projectBenchmarkBehavior, projectBenchmarkContext } from "./evaluation-observation";
import { REPRESENTATIVE_FIXTURE_PATH } from "./representative-fixture";
import { startRecordLoopbackServer } from "./record-loopback-server";

const RESPONSE_DIRECTORY = new URL("../../../packages/fixtures/model-responses/", import.meta.url).pathname;
const TEST_PROVENANCE = { repository: "bc-news" as const, commit_sha: "7777777777777777777777777777777777777777", dirty: false as const };

export class BenchmarkRuntimeEvidenceVerificationError extends Error {
	readonly code: string;
	constructor(code: string, message: string) {
		super(message);
		this.name = "BenchmarkRuntimeEvidenceVerificationError";
		this.code = code;
	}
}

function assertProof(condition: boolean, code: string, message: string): asserts condition {
	if (!condition) throw new BenchmarkRuntimeEvidenceVerificationError(code, message);
}

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function withRewrittenNestedIdentities(run: V9BenchmarkRun): V9BenchmarkRun {
	const rewritten = clone(run);
	rewritten.id = "independent-runtime-evidence-proof";
	for (const [trialIndex, trial] of rewritten.trials.entries()) {
		const originalTrialId = trial.id;
		const rewrittenTrialId = `independent-trial-${String(trialIndex + 1)}`;
		const invocationIdentities = new Map(trial.invocations.map((invocation, invocationIndex) => [
			invocation.id,
			`${rewrittenTrialId}-invocation-${String(invocationIndex + 1)}`,
		]));
		trial.id = rewrittenTrialId;
		for (const invocation of trial.invocations) {
			invocation.id = invocationIdentities.get(invocation.id)!;
			invocation.predecessor_invocation_id = invocation.predecessor_invocation_id === null
				? null
				: invocationIdentities.get(invocation.predecessor_invocation_id)!;
		}
		for (const step of PRODUCTION_MODEL_STEPS) {
			const selected = trial.selected_invocation_ids[step];
			trial.selected_invocation_ids[step] = selected === null ? null : invocationIdentities.get(selected)!;
		}
		const roster = rewritten.trial_roster[trialIndex];
		if (roster === undefined || roster.trial_id !== originalTrialId) throw new Error("Could not rewrite trial roster identity");
		roster.trial_id = rewrittenTrialId;
		for (const evidence of rewritten.runtime_evidence.filter(({ trial_id }) => trial_id === originalTrialId)) {
			evidence.trial_id = rewrittenTrialId;
			evidence.invocation_id = invocationIdentities.get(evidence.invocation_id)!;
		}
		for (const request of rewritten.gateway_requests.filter(({ trial_id }) => trial_id === originalTrialId)) {
			request.trial_id = rewrittenTrialId;
			request.invocation_id = invocationIdentities.get(request.invocation_id)!;
		}
	}
	return V9BenchmarkRunSchema.parse(rewritten);
}

async function responseOutputs(): Promise<Record<ProductionModelStep, string>> {
	return Object.fromEntries(await Promise.all(PRODUCTION_MODEL_STEPS.map(async (step) => {
		const response = RecordedModelResponseSchema.parse(
			JSON.parse(await readFile(join(RESPONSE_DIRECTORY, `${step}.json`), "utf8")) as unknown,
		);
		return [`runtime-evidence/${step}`, response.text];
	}))) as Record<ProductionModelStep, string>;
}

function verifierConfiguration() {
	return {
		production_steps: Object.fromEntries(PRODUCTION_MODEL_STEPS.map((step) => [step, {
			adapter: "openai_compatible_hosted",
			provider: "repository_loopback",
			model: `runtime-evidence/${step}`,
			billing: {
				method: "calculated",
				input_usd_per_million_tokens: 0,
				output_usd_per_million_tokens: 0,
				pricing_reference: "repository runtime evidence verifier",
			},
		}])),
	};
}

function assertStrictRoster(run: V9BenchmarkRun, snapshots: readonly BenchmarkRun[]): void {
	assertProof(run.runtime_evidence.length === run.trials[0]?.invocations.length, "runtime_roster_length", "Runtime roster did not retain one entry per invocation");
	assertProof(
		new Set(run.runtime_evidence.filter(({ state }) => state === "captured").map(({ production_step }) => production_step)).size === PRODUCTION_MODEL_STEPS.length,
		"runtime_roster_roles",
		`Runtime roster did not retain all current production roles (records=${String(run.runtime_evidence.length)})`,
	);
	assertProof(run.runtime_evidence.every(({ state }) => state === "captured"), "runtime_roster_capture", "A successful invocation did not retain captured runtime evidence");
	assertProof(run.gateway_requests.length === run.trials[0]?.invocations.length, "gateway_roster_length", "Gateway roster did not retain one entry per invocation");
	assertProof(run.gateway_requests.every(({ state }) => state === "not_applicable"), "gateway_roster_capture", "Non-Gateway verification expected every successful invocation to mark Gateway provenance not applicable");

	const missing = clone(run);
	missing.runtime_evidence.pop();
	assertProof(!V9BenchmarkRunSchema.safeParse(missing).success, "missing_runtime_accepted", "V9 accepted missing runtime evidence");
	const duplicate = clone(run);
	duplicate.runtime_evidence[1] = clone(duplicate.runtime_evidence[0]!);
	assertProof(!V9BenchmarkRunSchema.safeParse(duplicate).success, "duplicate_runtime_accepted", "V9 accepted duplicate runtime evidence");
	const reordered = clone(run);
	[reordered.runtime_evidence[0], reordered.runtime_evidence[1]] = [reordered.runtime_evidence[1]!, reordered.runtime_evidence[0]!];
	assertProof(!V9BenchmarkRunSchema.safeParse(reordered).success, "reordered_runtime_accepted", "V9 accepted reordered runtime evidence");
	const detached = clone(run);
	detached.runtime_evidence[0]!.trial_id = "detached-trial";
	assertProof(!V9BenchmarkRunSchema.safeParse(detached).success, "detached_runtime_accepted", "V9 accepted detached runtime evidence");

	const inFlight = snapshots.find((snapshot): snapshot is V9BenchmarkRun => snapshot.version === 9
		&& snapshot.runtime_evidence.some(({ state }) => state === "pending"));
	assertProof(inFlight !== undefined, "pending_snapshot_missing", "Command/store path did not retain a pending runtime observation");
	const premature = clone(inFlight);
	const pendingIndex = premature.runtime_evidence.findIndex(({ state }) => state === "pending");
	const captured = run.runtime_evidence.find(({ state }) => state === "captured");
	assertProof(pendingIndex >= 0 && captured?.state === "captured", "premature_setup_failed", "Could not construct premature-resolution proof");
	premature.runtime_evidence[pendingIndex] = {
		...premature.runtime_evidence[pendingIndex]!,
		state: "captured",
		evidence: captured.evidence,
	};
	assertProof(!V9BenchmarkRunSchema.safeParse(premature).success, "premature_runtime_accepted", "V9 accepted captured evidence for an in-flight invocation");

	const mutated = clone(run);
	const firstCaptured = mutated.runtime_evidence[0];
	assertProof(firstCaptured?.state === "captured", "mutated_setup_failed", "Could not construct runtime mutation proof");
	firstCaptured.evidence.execution_context.response_model.identifier = { state: "observed", value: "mutated-response-model" };
	assertProof(!V9BenchmarkRunSchema.safeParse(mutated).success, "mutated_runtime_accepted", "V9 accepted runtime evidence detached from the retained completion");
}

export async function verifyBenchmarkRuntimeEvidence(temporaryRoot?: string): Promise<void> {
	const root = temporaryRoot ?? await mkdtemp(join(tmpdir(), "bc-news-runtime-evidence-"));
	await mkdir(root, { recursive: true });
	const resultsDirectory = join(root, "results");
	const configPath = join(root, "config.json");
	await writeFile(configPath, `${JSON.stringify(verifierConfiguration(), null, 2)}\n`, "utf8");
	const server = await startRecordLoopbackServer(await responseOutputs());
	const snapshots: BenchmarkRun[] = [];
	try {
		const result = await evaluateTrialCommand({
			fixturePath: REPRESENTATIVE_FIXTURE_PATH,
			configPath,
			resultsDirectory,
			environment: { HOSTED_MODEL_BASE_URL: server.baseUrl, HOSTED_MODEL_API_KEY: "record-loopback-proof" },
			sourceProvenance: TEST_PROVENANCE,
			artifactObserver: (artifact) => { snapshots.push(structuredClone(artifact)); },
		});
		const retained = await loadBenchmarkRun(result.benchmark.id, resultsDirectory);
		assertProof(retained.version === 9, "current_version", "Current benchmark command did not produce strict V9");
		assertProof(isDeepStrictEqual(retained, result.benchmark), "store_reader_mismatch", "Store/read path changed retained V9 evidence");
		assertStrictRoster(retained, snapshots);
		const resolvedSnapshot = snapshots.find((snapshot): snapshot is V9BenchmarkRun => snapshot.version === 9
			&& snapshot.lifecycle === "running"
			&& snapshot.runtime_evidence.some(({ state }) => state === "captured"));
		assertProof(resolvedSnapshot !== undefined, "resolved_snapshot_missing", "Command/store path did not retain a resolved running observation");
		const transitionPath = join(root, "resolved-transition-proof.json");
		const transitionStore = await EvaluationArtifactStore.create(transitionPath, resolvedSnapshot);
		const mutatedResolved = clone(resolvedSnapshot);
		const resolvedRecord = mutatedResolved.runtime_evidence.find(({ state }) => state === "captured");
		assertProof(resolvedRecord?.state === "captured", "resolved_mutation_setup", "Could not construct resolved runtime mutation proof");
		resolvedRecord.evidence.prediction_observation.total_time_ms = { state: "observed", value: 999 };
		let transitionRejected = false;
		try { await transitionStore.replace(mutatedResolved); }
		catch { transitionRejected = true; }
		assertProof(transitionRejected, "resolved_mutation_accepted", "Store transition accepted mutated resolved runtime evidence");

		const completionKeys = retained.trials.flatMap(({ invocations }) => invocations)
			.filter((invocation) => invocation.transport === "succeeded")
			.map(({ completion }) => Object.keys(completion));
		assertProof(completionKeys.every((keys) => !keys.includes("runtime_evidence")), "legacy_completion_leak", "V9 leaked runtime evidence into a retained completion object");
		const states = retained.runtime_evidence.flatMap((record) => record.state === "captured"
			? Object.values(record.evidence.execution_context).flatMap((value) => typeof value === "object" && value !== null && "state" in value ? [value.state] : [])
			: []);
		assertProof(states.includes("observed") && states.includes("unknown") && states.includes("externally_controlled"), "observation_states_missing", "Controlled providers did not exercise observed, unknown, and externally controlled fields");

		const contextText = JSON.stringify(projectBenchmarkContext(retained));
		const behaviorText = JSON.stringify(projectBenchmarkBehavior(retained));
		assertProof(contextText.includes("execution_context") && !contextText.includes("prediction_observation"), "context_projection_leak", "Context projection did not isolate execution context");
		assertProof(behaviorText.includes("prediction_observation") && !behaviorText.includes("execution_context"), "behavior_projection_leak", "Behavior projection did not isolate prediction observations");
		const independentIdentityRun = withRewrittenNestedIdentities(retained);
		const independentComparison = compareBenchmarkRuns(retained, independentIdentityRun);
		assertProof(independentComparison.contextDifferences.length === 0, "run_identity_context_difference", "Independent run, trial, or invocation identities changed the context projection");
		const summary = summarizeBenchmarkRun(retained);
		assertProof(summary.runtime_evidence.length === PRODUCTION_MODEL_STEPS.length, "summary_runtime_missing", "Summary did not expose the runtime roster");

	} finally {
		await server.close();
		if (temporaryRoot === undefined) await rm(root, { recursive: true, force: true });
	}
	console.log("BENCHMARK RUNTIME EVIDENCE VERIFIED");
}

if (import.meta.url === `file://${process.argv[1]}`) {
	verifyBenchmarkRuntimeEvidence().catch((error: unknown) => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}
