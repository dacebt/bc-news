import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PRODUCTION_MODEL_STEPS } from "@bc-news/generation-core";
import { expect, test } from "vitest";
import {
	BenchmarkRunSchema, evaluationConfigIdentity, evaluationOutputContractProvenance,
} from "../src/evaluation-artifact";
import { EvaluationArtifactStore } from "../src/evaluation-artifact-store";
import { REPRESENTATIVE_FIXTURE_PATH } from "../src/representative-fixture";
import { evaluateTrialCommand } from "../src/evaluation-trial-command";
import {
	TEST_SOURCE_PROVENANCE, clone, controlledEvaluation, rejectsWithoutChangingBytes, sha256Json, temporaryRoot,
} from "./evaluation-artifact-test-support";

test("accepts recovered retry evidence without classifying the trial as infrastructure incomplete", async () => {
	const { result, resultsDirectory } = await controlledEvaluation();
	const recovered = clone(result.benchmark);
	const trial = recovered.trials[0]!;
	const selectedWriterId = trial.selected_invocation_ids.main_story_write;
	const selectedWriter = trial.invocations.find(({ id }) => id === selectedWriterId)!;
	const failedWriterId = `${trial.id}-recovered-predecessor`;
	trial.invocations.unshift({
		id: failedWriterId, production_step: "main_story_write", config_identity: trial.config_identity,
		ordinal: 1, predecessor_invocation_id: null, request: clone(selectedWriter.request),
		request_sha256: selectedWriter.request_sha256, started_at: selectedWriter.started_at,
		transport: "failed", failure: { code: "controlled_retryable", message: "controlled retryable transport failure" },
		ended_at: selectedWriter.started_at, duration_ms: 0,
		retry_classification: { state: "classified", eligible: true, reason: "controlled retry proof" },
		parse: { state: "pending" },
	});
	for (const [index, invocation] of trial.invocations.entries()) invocation.ordinal = index + 1;
	selectedWriter.predecessor_invocation_id = failedWriterId;
	expect(BenchmarkRunSchema.safeParse(recovered).success).toBe(true);
	const misclassified = clone(recovered);
	misclassified.trials[0]!.subject_outcome = "infrastructure_incomplete";
	misclassified.outcome_counts.completed = 0;
	misclassified.outcome_counts.infrastructure_incomplete = 1;
	expect(BenchmarkRunSchema.safeParse(misclassified).success).toBe(false);
	const path = join(resultsDirectory, "retry-linkage-copy.json");
	const store = await EvaluationArtifactStore.create(path, recovered);
	const mutations = [];
	const nullPredecessor = clone(recovered);
	nullPredecessor.trials[0]!.invocations[1]!.predecessor_invocation_id = null;
	mutations.push(nullPredecessor);
	const wrongPredecessor = clone(recovered);
	wrongPredecessor.trials[0]!.invocations[1]!.predecessor_invocation_id = wrongPredecessor.trials[0]!.invocations[2]!.id;
	mutations.push(wrongPredecessor);
	const firstHasPredecessor = clone(recovered);
	firstHasPredecessor.trials[0]!.invocations[0]!.predecessor_invocation_id = selectedWriter.id;
	mutations.push(firstHasPredecessor);
	const nonretryablePredecessor = clone(recovered);
	const nonretryable = nonretryablePredecessor.trials[0]!.invocations[0]!;
	if (nonretryable.transport !== "failed") throw new Error("expected failed retry predecessor");
	nonretryable.retry_classification = { state: "classified", eligible: false, reason: "controlled nonretryable proof" };
	mutations.push(nonretryablePredecessor);
	const pendingPredecessor = clone(recovered);
	const pending = pendingPredecessor.trials[0]!.invocations[0]!;
	if (pending.transport !== "failed") throw new Error("expected failed retry predecessor");
	pending.retry_classification = { state: "pending" };
	mutations.push(pendingPredecessor);
	const successfulPredecessor = clone(recovered);
	const originalPredecessor = successfulPredecessor.trials[0]!.invocations[0]!;
	const retry = successfulPredecessor.trials[0]!.invocations[1]!;
	if (retry.transport !== "succeeded") throw new Error("expected successful retry");
	successfulPredecessor.trials[0]!.invocations[0] = { ...clone(retry), id: originalPredecessor.id, ordinal: 1, predecessor_invocation_id: null };
	mutations.push(successfulPredecessor);
	const changedRetryRequest = clone(recovered);
	const changedRetry = changedRetryRequest.trials[0]!.invocations[1]!;
	changedRetry.request.user += " changed on retry";
	changedRetry.request_sha256 = sha256Json(changedRetry.request);
	mutations.push(changedRetryRequest);
	for (const mutation of mutations) {
		expect(BenchmarkRunSchema.safeParse(mutation).success).toBe(false);
		await rejectsWithoutChangingBytes(store, path, mutation);
	}
});

test("rejects unreachable track selections for both editorial tracks", async () => {
	const { result } = await controlledEvaluation();
	for (const trackName of ["main_story", "announcements"] as const) {
		const mutation = clone(result.benchmark);
		mutation.trials[0]!.selected_invocation_ids[`${trackName}_write`] = null;
		expect(BenchmarkRunSchema.safeParse(mutation).success).toBe(false);
		const orderMutation = clone(result.benchmark);
		const writerIndex = trackName === "main_story" ? 0 : 2;
		const copyeditIndex = writerIndex + 1;
		const writer = orderMutation.trials[0]!.invocations[writerIndex]!;
		const copyedit = orderMutation.trials[0]!.invocations[copyeditIndex]!;
		orderMutation.trials[0]!.invocations[writerIndex] = { ...copyedit, ordinal: writerIndex + 1 };
		orderMutation.trials[0]!.invocations[copyeditIndex] = { ...writer, ordinal: copyeditIndex + 1 };
		expect(BenchmarkRunSchema.safeParse(orderMutation).success).toBe(false);
	}
});

test("requires the exact frozen version 1 output-contract provenance", async () => {
	const { result } = await controlledEvaluation();
	const historical = clone(result.benchmark);
	const retained = historical.provenance.output_contracts[0];
	retained.canonical_schema = { title: "historical-v1-contract", type: "string" };
	retained.schema_sha256 = sha256Json(retained.canonical_schema);
	expect(BenchmarkRunSchema.safeParse(historical).success).toBe(false);
	const hashMutation = clone(result.benchmark);
	hashMutation.provenance.output_contracts[0].schema_sha256 = "f".repeat(64);
	expect(BenchmarkRunSchema.safeParse(hashMutation).success).toBe(false);
	expect(result.benchmark.provenance.output_contracts).toEqual(evaluationOutputContractProvenance());
});

test("binds the complete prepared-evidence snapshot to its identity and summary", async () => {
	const { result } = await controlledEvaluation();
	const changedSnapshot = clone(result.benchmark);
	changedSnapshot.prepared_evidence.snapshot.messages[0]!.text += " changed";
	expect(BenchmarkRunSchema.safeParse(changedSnapshot).success).toBe(false);
	const changedSummary = clone(result.benchmark);
	changedSummary.prepared_evidence.final_count -= 1;
	expect(BenchmarkRunSchema.safeParse(changedSummary).success).toBe(false);
});

test("requires exact clean-commit code provenance", async () => {
	const { result } = await controlledEvaluation();
	const invalidCommit = clone(result.benchmark);
	invalidCommit.provenance.code.commit_sha = "f".repeat(39);
	expect(BenchmarkRunSchema.safeParse(invalidCommit).success).toBe(false);
	const extraHash = clone(result.benchmark) as unknown as { provenance: { code: Record<string, unknown> } };
	extraHash.provenance.code.workspace_sha256 = "f".repeat(64);
	expect(BenchmarkRunSchema.safeParse(extraHash).success).toBe(false);
});

test("rejects invocation chronology below benchmark or trial and out of ordinal order", async () => {
	const { result } = await controlledEvaluation();
	const belowTrial = clone(result.benchmark);
	const firstBelowTrial = belowTrial.trials[0]!.invocations[0]!;
	if (firstBelowTrial.transport === "in_flight") throw new Error("expected ended invocation");
	firstBelowTrial.started_at = new Date(Date.parse(belowTrial.trials[0]!.started_at) - 1).toISOString();
	firstBelowTrial.duration_ms = Date.parse(firstBelowTrial.ended_at) - Date.parse(firstBelowTrial.started_at);
	expect(BenchmarkRunSchema.safeParse(belowTrial).success).toBe(false);
	const outOfOrder = clone(result.benchmark);
	const secondOutOfOrder = outOfOrder.trials[0]!.invocations[1]!;
	if (secondOutOfOrder.transport === "in_flight") throw new Error("expected ended invocation");
	secondOutOfOrder.started_at = new Date(Date.parse(outOfOrder.trials[0]!.invocations[0]!.started_at) - 1).toISOString();
	secondOutOfOrder.duration_ms = Date.parse(secondOutOfOrder.ended_at) - Date.parse(secondOutOfOrder.started_at);
	expect(BenchmarkRunSchema.safeParse(outOfOrder).success).toBe(false);
});

test("accepts truthful resolved model provenance distinct from the requested model", async () => {
	const { result } = await controlledEvaluation();
	const resolved = clone(result.benchmark);
	const invocation = resolved.trials[0]!.invocations[0]!;
	if (invocation.transport !== "succeeded") throw new Error("expected succeeded invocation");
	const requested = resolved.declaration.configurations[0].config.production_steps.main_story_write;
	if (requested.adapter !== "openai_compatible_hosted") throw new Error("expected hosted declaration");
	invocation.completion.model = "canonical/resolved-main-story-model";
	expect(invocation.completion.model).not.toBe(requested.model);
	expect(BenchmarkRunSchema.safeParse(resolved).success).toBe(true);
});

test("binds usage and billing evidence to the declared adapter", async () => {
	const { result } = await controlledEvaluation();
	const hostedUsage = clone(result.benchmark);
	const hostedInvocation = hostedUsage.trials[0]!.invocations[0]!;
	if (hostedInvocation.transport !== "succeeded") throw new Error("expected hosted completion");
	hostedInvocation.completion.token_usage = { measurement: "unavailable" };
	expect(BenchmarkRunSchema.safeParse(hostedUsage).success).toBe(false);

	const hostedBilling = clone(result.benchmark);
	const billedInvocation = hostedBilling.trials[0]!.invocations[0]!;
	if (billedInvocation.transport !== "succeeded") throw new Error("expected hosted completion");
	if (billedInvocation.completion.external_billing.classification !== "calculated") throw new Error("expected calculated hosted billing");
	billedInvocation.completion.external_billing = {
		classification: "calculated",
		amount_usd: billedInvocation.completion.external_billing.amount_usd + 1,
		pricing_reference: "unrelated pricing",
	};
	expect(BenchmarkRunSchema.safeParse(hostedBilling).success).toBe(false);

	const local = clone(result.benchmark);
	local.declaration.configurations[0].config.production_steps.main_story_write = {
		adapter: "lmstudio",
		model: "local/requested-model",
		sampling: { temperature: 0.2, top_p: 0.95, top_k: 40 },
		reasoning_effort: "medium",
	};
	const localIdentity = evaluationConfigIdentity(local.declaration.configurations[0].config);
	local.declaration.configurations[0].identity = localIdentity;
	local.trial_roster[0].config_identity = localIdentity;
	local.trials[0]!.config_identity = localIdentity;
	for (const invocation of local.trials[0]!.invocations) invocation.config_identity = localIdentity;
	const localInvocation = local.trials[0]!.invocations[0]!;
	if (localInvocation.transport !== "succeeded") throw new Error("expected local completion");
	localInvocation.completion.execution = "local_inference";
	localInvocation.completion.provider = "lmstudio";
	localInvocation.completion.external_billing = {
		classification: "none", amount_usd: 0, reason: "local_inference",
	};
	expect(BenchmarkRunSchema.safeParse(local).success).toBe(true);
	localInvocation.completion.external_billing = { classification: "provider_reported", amount_usd: 0 };
	expect(BenchmarkRunSchema.safeParse(local).success).toBe(false);
});

test("generated results do not change injected code provenance across runs", async () => {
	const { results } = await controlledEvaluation(undefined, 2);
	expect(results).toHaveLength(2);
	expect(results[0]!.benchmark.provenance.code).toEqual(TEST_SOURCE_PROVENANCE);
	expect(results[1]!.benchmark.provenance.code).toEqual(TEST_SOURCE_PROVENANCE);
});

test("live evaluation rejects recorded adapters before artifact creation", async () => {
	const root = await temporaryRoot("bc-news-recorded-rejection-");
	const configPath = join(root, "config.json");
	await writeFile(configPath, `${JSON.stringify({ production_steps: Object.fromEntries(PRODUCTION_MODEL_STEPS.map((step) => [step, { adapter: "recorded" }])) })}\n`, "utf8");
	await expect(evaluateTrialCommand({ fixturePath: REPRESENTATIVE_FIXTURE_PATH, configPath, resultsDirectory: join(root, "results"), environment: {}, sourceProvenance: TEST_SOURCE_PROVENANCE })).rejects.toMatchObject({ code: "recorded_adapter_rejected_for_live_evaluation" });
	await expect(readFile(join(root, "results"))).rejects.toBeDefined();
});
