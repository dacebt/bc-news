import { readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { BenchmarkRunSchema, type BenchmarkRun } from "../src/evaluation-artifact";
import { EvaluationArtifactStore, EvaluationArtifactStoreError } from "../src/evaluation-artifact-store";
import { clone, controlledEvaluation, preservationRejectedCopyeditOutput, rejectsWithoutChangingBytes, sha256Json, temporaryRoot } from "./evaluation-artifact-test-support";

test("retains every provider invocation on disk before observer notification", async () => {
	const states: BenchmarkRun[] = [];
	const { result } = await controlledEvaluation(async (notified, resultsDirectory) => {
		const retained = BenchmarkRunSchema.parse(JSON.parse(await readFile(join(resultsDirectory, `${notified.id}.json`), "utf8")) as unknown);
		expect(retained).toEqual(notified);
		states.push(retained);
	});
	for (const invocation of result.benchmark.trials[0]!.invocations) {
		const inFlight = states.findIndex((state) => state.trials[0]!.invocations.some((candidate) => candidate.id === invocation.id && candidate.transport === "in_flight"));
		const successfulPreParse = states.findIndex((state) => state.trials[0]!.invocations.some((candidate) => candidate.id === invocation.id && candidate.transport === "succeeded" && candidate.parse.state === "pending"));
		expect(inFlight).toBeGreaterThanOrEqual(0);
		expect(successfulPreParse).toBeGreaterThan(inFlight);
	}
});

test("notifies observers with a separately parsed disk artifact", async () => {
	const states: BenchmarkRun[] = [];
	const { resultsDirectory } = await controlledEvaluation((artifact) => { states.push(artifact); });
	const path = join(resultsDirectory, "observer-copy.json");
	const notifications: BenchmarkRun[] = [];
	const store = await EvaluationArtifactStore.create(path, states[0]!, (artifact) => { notifications.push(artifact); });
	await store.replace(states[1]!);
	expect(notifications[0]).toEqual(states[0]);
	expect(notifications[0]).not.toBe(states[0]);
	expect(notifications[1]).toEqual(states[1]);
	expect(notifications[1]).not.toBe(states[1]);
});

test("removes a written temporary artifact when atomic rename fails", async () => {
	const states: BenchmarkRun[] = [];
	await controlledEvaluation((artifact) => { states.push(artifact); });
	const root = await temporaryRoot("bc-news-atomic-failure-test-");
	const path = join(root, "authoritative.json");
	const store = await EvaluationArtifactStore.create(path, states[0]!, undefined, {
		writeFile,
		rename: () => Promise.reject(new Error("controlled rename failure")),
		unlink,
	});
	const originalBytes = await readFile(path);
	await expect(store.replace(states[1]!)).rejects.toMatchObject({ code: "write_rejected" });
	expect(await readFile(path)).toEqual(originalBytes);
	expect(await readdir(root)).toEqual(["authoritative.json"]);
});

test("reports temporary artifact cleanup failure without replacing the primary write rejection", async () => {
	const states: BenchmarkRun[] = [];
	await controlledEvaluation((artifact) => { states.push(artifact); });
	const root = await temporaryRoot("bc-news-atomic-cleanup-failure-test-");
	const path = join(root, "authoritative.json");
	let temporaryPath: string | undefined;
	const store = await EvaluationArtifactStore.create(path, states[0]!, undefined, {
		writeFile: async (candidatePath, data, options) => {
			if (typeof candidatePath !== "string") throw new Error("Expected string temporary artifact path");
			temporaryPath = candidatePath;
			await writeFile(candidatePath, data, options);
		},
		rename: () => Promise.reject(new Error("controlled rename failure")),
		unlink: () => Promise.reject(new Error("controlled cleanup failure")),
	});
	const originalBytes = await readFile(path);
	let failure: unknown;
	try { await store.replace(states[1]!); }
	catch (cause: unknown) { failure = cause; }
	expect(failure).toBeInstanceOf(EvaluationArtifactStoreError);
	if (!(failure instanceof EvaluationArtifactStoreError)) throw new Error("Expected artifact store failure");
	expect(failure.code).toBe("write_rejected");
	const cleanupFailure = failure.cleanup_failure;
	expect(cleanupFailure).toBeDefined();
	if (cleanupFailure === undefined) throw new Error("Expected temporary artifact cleanup failure");
	expect(cleanupFailure.path).toContain(".tmp");
	expect(failure.cause).toBeInstanceOf(Error);
	expect((failure.cause as Error).message).toBe("controlled rename failure");
	expect(await readFile(path)).toEqual(originalBytes);
	expect(temporaryPath).toBeDefined();
	await unlink(temporaryPath!);
});

test("enforces monotonic disk-authoritative transitions", async () => {
	const states: BenchmarkRun[] = [];
	await controlledEvaluation((artifact) => { states.push(artifact); });
	const root = await temporaryRoot("bc-news-transition-test-");
	const replayPath = join(root, "replay.json");
	const replay = await EvaluationArtifactStore.create(replayPath, states[0]!);
	for (const state of states.slice(1)) await replay.replace(state);

	const inFlightIndex = states.findIndex((state) => state.trials[0]!.invocations.at(-1)?.transport === "in_flight");
	expect(inFlightIndex).toBeGreaterThan(0);
	const inFlight = states[inFlightIndex]!;
	const inFlightPath = join(root, "in-flight.json");
	const inFlightStore = await EvaluationArtifactStore.create(inFlightPath, inFlight);
	const identityMutation = clone(inFlight); identityMutation.id = `${identityMutation.id}-changed`;
	await rejectsWithoutChangingBytes(inFlightStore, inFlightPath, identityMutation);
	const requestMutation = clone(inFlight);
	requestMutation.trials[0]!.invocations.at(-1)!.request.user += " changed";
	requestMutation.trials[0]!.invocations.at(-1)!.request_sha256 = sha256Json(requestMutation.trials[0]!.invocations.at(-1)!.request);
	await rejectsWithoutChangingBytes(inFlightStore, inFlightPath, requestMutation);
	await rejectsWithoutChangingBytes(inFlightStore, inFlightPath, states[inFlightIndex - 1]!);
	const shortcut = clone(states[inFlightIndex + 2]!);
	await rejectsWithoutChangingBytes(inFlightStore, inFlightPath, shortcut);
	const classifiedShortcut = clone(inFlight);
	const classifiedInvocation = classifiedShortcut.trials[0]!.invocations.at(-1)!;
	classifiedShortcut.trials[0]!.invocations[classifiedShortcut.trials[0]!.invocations.length - 1] = {
		...classifiedInvocation,
		transport: "failed",
		failure: { code: "controlled", message: "controlled failure" },
		ended_at: new Date().toISOString(),
		duration_ms: 0,
		retry_classification: { state: "classified", eligible: false, reason: "controlled deterministic failure" },
		parse: { state: "pending" },
	};
	await rejectsWithoutChangingBytes(inFlightStore, inFlightPath, classifiedShortcut);

	const selectedIndex = states.findIndex((state) => state.trials[0]!.selected_invocation_ids.main_story_write !== null && state.trials[0]!.tracks.main_story.lifecycle === "running");
	expect(selectedIndex).toBeGreaterThan(0);
	const selected = states[selectedIndex]!;
	const selectedPath = join(root, "selected.json");
	const selectedStore = await EvaluationArtifactStore.create(selectedPath, selected);
	const selectionRollback = clone(selected); selectionRollback.trials[0]!.selected_invocation_ids.main_story_write = null;
	await rejectsWithoutChangingBytes(selectedStore, selectedPath, selectionRollback);
	const parseRollback = clone(selected);
	const selectedWriter = parseRollback.trials[0]!.invocations.find(({ id }) => id === parseRollback.trials[0]!.selected_invocation_ids.main_story_write)!;
	if (selectedWriter.transport !== "succeeded") throw new Error("expected selected writer success");
	selectedWriter.parse = { state: "pending" };
	parseRollback.trials[0]!.selected_invocation_ids.main_story_write = null;
	await rejectsWithoutChangingBytes(selectedStore, selectedPath, parseRollback);

	const terminalTrackIndex = states.findIndex((state) => state.lifecycle === "running" && state.trials[0]!.tracks.main_story.lifecycle === "completed");
	expect(terminalTrackIndex).toBeGreaterThan(0);
	const terminalTrack = states[terminalTrackIndex]!;
	const terminalTrackPath = join(root, "terminal-track.json");
	const terminalTrackStore = await EvaluationArtifactStore.create(terminalTrackPath, terminalTrack);
	const trackRollback = clone(terminalTrack);
	trackRollback.trials[0]!.tracks.main_story = { lifecycle: "running", subject_outcome: null, terminal_production_step: null, product: null, findings: [] };
	await rejectsWithoutChangingBytes(terminalTrackStore, terminalTrackPath, trackRollback);

	const complete = states.at(-1)!;
	const completePath = join(root, "complete.json");
	const completeStore = await EvaluationArtifactStore.create(completePath, complete);
	await rejectsWithoutChangingBytes(completeStore, completePath, complete);
});

test("rejects semantic corruption and preserves authoritative bytes after invalid replacement", async () => {
	const { result, resultsDirectory } = await controlledEvaluation();
	const copyPath = join(resultsDirectory, "copy.json");
	const store = await EvaluationArtifactStore.create(copyPath, result.benchmark);
	const mutations: BenchmarkRun[] = [];
	const staleHash = clone(result.benchmark); staleHash.trials[0]!.invocations[0]!.request.user += "corrupt"; mutations.push(staleHash);
	const duplicateId = clone(result.benchmark); duplicateId.trials[0]!.invocations[1]!.id = duplicateId.trials[0]!.invocations[0]!.id; mutations.push(duplicateId);
	const mismatchedIdentity = clone(result.benchmark); mismatchedIdentity.trials[0]!.invocations[0]!.config_identity = "config-mismatch"; mutations.push(mismatchedIdentity);
	const countContradiction = clone(result.benchmark); countContradiction.outcome_counts.completed = 0; countContradiction.outcome_counts.parse_rejected = 1; mutations.push(countContradiction);
	const lifecycleContradiction = clone(result.benchmark); lifecycleContradiction.completed_at = null; mutations.push(lifecycleContradiction);
	const trackContradiction = clone(result.benchmark); trackContradiction.trials[0]!.tracks.main_story.product = null; mutations.push(trackContradiction);
	const terminalContradiction = clone(result.benchmark); terminalContradiction.trials[0]!.tracks.main_story.terminal_production_step = "announcements_copyedit"; mutations.push(terminalContradiction);
	const findingContradiction = clone(result.benchmark); findingContradiction.trials[0]!.tracks.main_story.findings = [{ kind: "final_product", production_step: "announcements_copyedit", code: "wrong", message: "wrong track" }]; mutations.push(findingContradiction);
	const invalidSelection = clone(result.benchmark); invalidSelection.trials[0]!.selected_invocation_ids.main_story_copyedit = "missing-invocation"; mutations.push(invalidSelection);
	const fabricatedMainProduct = clone(result.benchmark); fabricatedMainProduct.trials[0]!.tracks.main_story.product!.title = "Fabricated retained title"; mutations.push(fabricatedMainProduct);
	const fabricatedAnnouncementsProduct = clone(result.benchmark); fabricatedAnnouncementsProduct.trials[0]!.tracks.announcements.product = { announcements: [] }; mutations.push(fabricatedAnnouncementsProduct);
	const staleParseSuccess = clone(result.benchmark);
	const staleWriter = staleParseSuccess.trials[0]!.invocations.find(({ production_step }) => production_step === "main_story_write")!;
	if (staleWriter.transport !== "succeeded") throw new Error("expected succeeded writer");
	staleWriter.completion.text = "not json";
	mutations.push(staleParseSuccess);
	const coordinatedReplacement = clone(result.benchmark);
	const coordinatedCopyedit = coordinatedReplacement.trials[0]!.invocations.find(({ id }) => id === coordinatedReplacement.trials[0]!.selected_invocation_ids.main_story_copyedit)!;
	if (coordinatedCopyedit.transport !== "succeeded" || coordinatedCopyedit.parse.state !== "succeeded") throw new Error("expected selected copyedit parse success");
	coordinatedCopyedit.parse.output.title = "Fabricated coordinated title";
	coordinatedReplacement.trials[0]!.tracks.main_story.product!.title = "Fabricated coordinated title";
	mutations.push(coordinatedReplacement);
	const detachedMainRequest = clone(result.benchmark);
	const selectedMainCopyedit = detachedMainRequest.trials[0]!.invocations.find(({ id }) => id === detachedMainRequest.trials[0]!.selected_invocation_ids.main_story_copyedit)!;
	selectedMainCopyedit.request.user += "\nDetached from selected writer output.";
	selectedMainCopyedit.request_sha256 = sha256Json(selectedMainCopyedit.request);
	mutations.push(detachedMainRequest);
	const detachedAnnouncementsRequest = clone(result.benchmark);
	const selectedAnnouncementsCopyedit = detachedAnnouncementsRequest.trials[0]!.invocations.find(({ id }) => id === detachedAnnouncementsRequest.trials[0]!.selected_invocation_ids.announcements_copyedit)!;
	selectedAnnouncementsCopyedit.request.user += "\nDetached from selected writer output.";
	selectedAnnouncementsCopyedit.request_sha256 = sha256Json(selectedAnnouncementsCopyedit.request);
	mutations.push(detachedAnnouncementsRequest);
	for (const writerStep of ["main_story_write", "announcements_write"] as const) {
		const changedSystem = clone(result.benchmark);
		const systemInvocation = changedSystem.trials[0]!.invocations.find(({ production_step }) => production_step === writerStep)!;
		systemInvocation.request.system += "\nmutated v1 writer system";
		systemInvocation.request_sha256 = sha256Json(systemInvocation.request);
		mutations.push(changedSystem);
		const changedUser = clone(result.benchmark);
		const userInvocation = changedUser.trials[0]!.invocations.find(({ production_step }) => production_step === writerStep)!;
		userInvocation.request.user += "\nmutated v1 prepared-evidence prompt";
		userInvocation.request_sha256 = sha256Json(userInvocation.request);
		mutations.push(changedUser);
	}
	const wrongDuration = clone(result.benchmark);
	const durationInvocation = wrongDuration.trials[0]!.invocations[0]!;
	if (durationInvocation.transport === "in_flight") throw new Error("expected ended invocation");
	durationInvocation.duration_ms += 1;
	mutations.push(wrongDuration);
	const reversedInvocation = clone(result.benchmark);
	const chronologicalInvocation = reversedInvocation.trials[0]!.invocations[0]!;
	if (chronologicalInvocation.transport === "in_flight") throw new Error("expected ended invocation");
	chronologicalInvocation.ended_at = new Date(Date.parse(chronologicalInvocation.started_at) - 1).toISOString();
	chronologicalInvocation.duration_ms = 0;
	mutations.push(reversedInvocation);
	const earlyTrial = clone(result.benchmark);
	earlyTrial.trials[0]!.started_at = new Date(Date.parse(earlyTrial.started_at) - 1).toISOString();
	mutations.push(earlyTrial);
	const earlyTrialCompletion = clone(result.benchmark);
	const latestInvocation = earlyTrialCompletion.trials[0]!.invocations.at(-1)!;
	earlyTrialCompletion.trials[0]!.completed_at = new Date(Date.parse(latestInvocation.started_at) - 1).toISOString();
	mutations.push(earlyTrialCompletion);
	const earlyBenchmarkCompletion = clone(result.benchmark);
	earlyBenchmarkCompletion.completed_at = new Date(Date.parse(earlyBenchmarkCompletion.trials[0]!.completed_at!) - 1).toISOString();
	mutations.push(earlyBenchmarkCompletion);
	for (const mutation of mutations) {
		expect(BenchmarkRunSchema.safeParse(mutation).success).toBe(false);
		await rejectsWithoutChangingBytes(store, copyPath, mutation);
	}
}, 15_000);

test("rejects retained parse findings that contradict the version 1 parser", async () => {
	const rejectedOutput = await preservationRejectedCopyeditOutput("main_story_copyedit");
	const { result, resultsDirectory } = await controlledEvaluation(undefined, 1, { main_story_copyedit: rejectedOutput });
	const path = join(resultsDirectory, "rejected-finding-copy.json");
	const store = await EvaluationArtifactStore.create(path, result.benchmark);
	const inconsistentFinding = clone(result.benchmark);
	const rejected = inconsistentFinding.trials[0]!.invocations.find(({ production_step }) => production_step === "main_story_copyedit")!;
	if (rejected.transport !== "succeeded" || rejected.parse.state !== "rejected") throw new Error("expected copyedit parse rejection");
	rejected.parse.findings = [{ kind: "preservation", production_step: "main_story_copyedit", code: "fabricated", message: "fabricated retained finding" }];
	expect(BenchmarkRunSchema.safeParse(inconsistentFinding).success).toBe(false);
	await rejectsWithoutChangingBytes(store, path, inconsistentFinding);

	const staleFinding = clone(result.benchmark);
	const staleRejected = staleFinding.trials[0]!.invocations.find(({ production_step }) => production_step === "main_story_copyedit")!;
	if (staleRejected.transport !== "succeeded") throw new Error("expected succeeded copyedit transport");
	staleRejected.completion.text = "not json";
	expect(BenchmarkRunSchema.safeParse(staleFinding).success).toBe(false);
	await rejectsWithoutChangingBytes(store, path, staleFinding);
});

test("binds every reached rejected copyedit request to its independently parsed writer", async () => {
	for (const copyeditStep of ["main_story_copyedit", "announcements_copyedit"] as const) {
		const writerStep = copyeditStep === "main_story_copyedit" ? "main_story_write" : "announcements_write";
		const rejectedOutput = await preservationRejectedCopyeditOutput(copyeditStep);
		const { result, resultsDirectory } = await controlledEvaluation(undefined, 1, { [copyeditStep]: rejectedOutput });
		const path = join(resultsDirectory, `${copyeditStep}-rejected-copy.json`);
		const store = await EvaluationArtifactStore.create(path, result.benchmark);
		const reachedCopyedit = result.benchmark.trials[0]!.invocations.find(({ production_step }) => production_step === copyeditStep)!;
		expect(reachedCopyedit.transport === "succeeded" && reachedCopyedit.parse.state === "rejected").toBe(true);
		expect(result.benchmark.trials[0]!.selected_invocation_ids[copyeditStep]).toBeNull();

		const fabricatedWriter = clone(result.benchmark);
		const writer = fabricatedWriter.trials[0]!.invocations.find(({ production_step }) => production_step === writerStep)!;
		if (writer.transport !== "succeeded" || writer.parse.state !== "succeeded") throw new Error("expected selected writer success");
		if (writerStep === "main_story_write") writer.parse.output.title = "Fabricated writer title";
		else (writer.parse.output.announcements as Array<Record<string, unknown>>)[0]!.summary = "Fabricated writer summary";
		expect(BenchmarkRunSchema.safeParse(fabricatedWriter).success).toBe(false);
		await rejectsWithoutChangingBytes(store, path, fabricatedWriter);

		const detachedRequest = clone(result.benchmark);
		const copyedit = detachedRequest.trials[0]!.invocations.find(({ production_step }) => production_step === copyeditStep)!;
		copyedit.request.user += "\nDetached from the selected writer.";
		copyedit.request_sha256 = sha256Json(copyedit.request);
		expect(BenchmarkRunSchema.safeParse(detachedRequest).success).toBe(false);
		await rejectsWithoutChangingBytes(store, path, detachedRequest);
	}
});

test("binds final-product rejection evidence to the selected copyedit output", async () => {
	const { result, resultsDirectory } = await controlledEvaluation();
	const rejected = clone(result.benchmark);
	const trial = rejected.trials[0]!;
	const invocation = trial.invocations.find(({ id }) => id === trial.selected_invocation_ids.main_story_copyedit)!;
	if (invocation.transport !== "succeeded" || invocation.parse.state !== "succeeded") throw new Error("expected selected copyedit success");
	const product = JSON.parse(invocation.completion.text) as Record<string, unknown>;
	product.title = `${String(product.title)} —`;
	invocation.completion.text = JSON.stringify(product);
	invocation.parse.output = clone(product);
	trial.tracks.main_story.product = clone(product);
	expect(BenchmarkRunSchema.safeParse(rejected).success).toBe(false);
	trial.tracks.main_story.lifecycle = "rejected";
	trial.tracks.main_story.subject_outcome = "final_product_rejected";
	trial.tracks.main_story.findings = [{ kind: "final_product", production_step: "main_story_copyedit", code: "final_product_1", message: "forbidden output marker: —" }];
	trial.subject_outcome = "final_product_rejected";
	rejected.outcome_counts.completed = 0;
	rejected.outcome_counts.final_product_rejected = 1;
	expect(BenchmarkRunSchema.safeParse(rejected).success).toBe(true);
	const path = join(resultsDirectory, "final-product-rejected-copy.json");
	const store = await EvaluationArtifactStore.create(path, rejected);

	const fabricated = clone(rejected);
	fabricated.trials[0]!.tracks.main_story.findings[0] = { kind: "final_product", production_step: "main_story_copyedit", code: "fabricated", message: "fabricated finding" };
	expect(BenchmarkRunSchema.safeParse(fabricated).success).toBe(false);
	await rejectsWithoutChangingBytes(store, path, fabricated);
	const missing = clone(rejected);
	missing.trials[0]!.tracks.main_story.findings = [];
	expect(BenchmarkRunSchema.safeParse(missing).success).toBe(false);
	await rejectsWithoutChangingBytes(store, path, missing);
	const extra = clone(rejected);
	extra.trials[0]!.tracks.main_story.findings.push({ kind: "final_product", production_step: "main_story_copyedit", code: "final_product_2", message: "extra finding" });
	expect(BenchmarkRunSchema.safeParse(extra).success).toBe(false);
	await rejectsWithoutChangingBytes(store, path, extra);
	const missingProduct = clone(rejected);
	missingProduct.trials[0]!.tracks.main_story.product = null;
	expect(BenchmarkRunSchema.safeParse(missingProduct).success).toBe(false);
	await rejectsWithoutChangingBytes(store, path, missingProduct);

	const preservationOutput = await preservationRejectedCopyeditOutput("main_story_copyedit");
	const preservation = await controlledEvaluation(undefined, 1, { main_story_copyedit: preservationOutput });
	const higherPrecedence = clone(preservation.result.benchmark);
	higherPrecedence.trials[0]!.tracks.main_story.findings = clone(rejected.trials[0]!.tracks.main_story.findings);
	expect(higherPrecedence.trials[0]!.tracks.main_story.subject_outcome).toBe("preservation_rejected");
	expect(BenchmarkRunSchema.safeParse(higherPrecedence).success).toBe(false);
	await rejectsWithoutChangingBytes(store, path, higherPrecedence);
});
