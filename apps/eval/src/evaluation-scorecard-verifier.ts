import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { PRODUCTION_MODEL_STEPS, type ProductionModelStep } from "@bc-news/generation-core";
import { runEvalCliApplication } from "./cli";
import { parseEvalCliCommand } from "./cli-options";
import { evaluateBenchmarkCommand } from "./evaluation-benchmark-command";
import type { V7BenchmarkRun } from "./evaluation-artifact";
import { canonical, evaluationConfigIdentity } from "./evaluation-artifact-schemas";
import { verifyBenchmarkRuntimeEvidence } from "./benchmark-runtime-evidence-verifier";
import { verifyEvaluationBenchmarkBrowsing } from "./evaluation-browse-verifier";
import { loadEvaluationReferenceCorpus, type LoadedEvaluationReferenceCorpusEntry } from "./evaluation-reference-corpus";
import { verifyEvaluationReferenceCorpus } from "./evaluation-reference-corpus-verifier";
import { buildEvaluationScorecard } from "./evaluation-scorecard-builder";
import { loadEvaluationScorecardInput, type LoadedEvaluationScorecardInput } from "./evaluation-scorecard-input";
import { formatEvaluationScorecardReport } from "./evaluation-scorecard-report";
import { EvaluationScorecardError, type EvaluationScorecardArtifact } from "./evaluation-scorecard";
import { createEvaluationScorecardArtifact, loadEvaluationScorecardArtifact } from "./evaluation-scorecard-store";
import { listRunFiles } from "./run-file";
import { verifyRecordedReplayAcceptance } from "./recorded-replay-acceptance-verifier";
import { startRecordLoopbackServer } from "./record-loopback-server";

type JsonObject = Record<string, unknown>;
const SOURCE_PROVENANCE = { repository: "bc-news" as const, commit_sha: "8888888888888888888888888888888888888888", dirty: false as const };

function hash(value: string | Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

function canonicalHash(value: object): string {
	return hash(JSON.stringify(canonical(value)));
}

function json(value: object): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

function assertProof(condition: boolean, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function verifierConfiguration(): JsonObject {
	return {
		configurations: [{ production_steps: Object.fromEntries(PRODUCTION_MODEL_STEPS.map((step) => [step, {
			adapter: "openai_compatible_hosted", provider: "repository_loopback", model: `scorecard/${step}`,
			billing: { method: "calculated", input_usd_per_million_tokens: 0, output_usd_per_million_tokens: 0, pricing_reference: "repository scorecard proof" },
		}])) }],
		repetition_count: 1,
		transport_retry_limit: 1,
	};
}

interface ClaimTemplate {
	readonly proposition: string;
	readonly referenceId: string;
	readonly relation: "supports" | "supports_status_qualified" | "unresolved";
	readonly grounding: "grounded" | "indeterminate";
	readonly body: string;
}

function claimTemplate(entry: LoadedEvaluationReferenceCorpusEntry): ClaimTemplate {
	const statusRecord = entry.reference.claims[0] ?? entry.reference.events[0];
	if (statusRecord !== undefined) {
		const kind = entry.reference.claims[0] === statusRecord ? "claim" : "event";
		if (statusRecord.status === "established") {
			const proposition = statusRecord.supporting_witnesses[0]!.excerpt;
			return { proposition, referenceId: `${kind}:${statusRecord.id}`, relation: "supports", grounding: "grounded", body: `Source record states: ${proposition} 😀` };
		}
		if (statusRecord.status === "contested") {
			const body = `Source accounts are contested: ${statusRecord.supporting_witnesses[0]!.excerpt} ${statusRecord.opposing_witnesses[0]!.excerpt}`;
			return { proposition: body, referenceId: `${kind}:${statusRecord.id}`, relation: "supports_status_qualified", grounding: "grounded", body };
		}
		const body = `Source accounts leave this unresolved: ${statusRecord.unresolved_witnesses[0]!.excerpt}`;
		return { proposition: body, referenceId: `${kind}:${statusRecord.id}`, relation: "unresolved", grounding: "indeterminate", body };
	}
	const ambiguity = entry.reference.ambiguities[0];
	if (ambiguity !== undefined) {
		const body = `Source accounts leave this unresolved: ${ambiguity.witnesses[0]!.excerpt}`;
		return { proposition: body, referenceId: `ambiguity:${ambiguity.id}`, relation: "unresolved", grounding: "indeterminate", body };
	}
	const noteworthy = entry.reference.noteworthy_candidates[0]!;
	const proposition = noteworthy.witnesses[0]!.excerpt;
	return { proposition, referenceId: `noteworthy:${noteworthy.id}`, relation: "supports", grounding: "grounded", body: `Source record notes: ${proposition}` };
}

async function startControlledFailureServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
	const server = createServer((_request, response) => {
		response.writeHead(500, { "content-type": "application/json" });
		response.end(JSON.stringify({ error: { message: "controlled transient failure" } }));
	});
	await new Promise<void>((resolvePromise, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolvePromise);
	});
	const address = server.address();
	assertProof(address !== null && typeof address !== "string", "Controlled failure server did not bind a TCP port");
	return {
		baseUrl: `http://127.0.0.1:${String(address.port)}`,
		close: () => new Promise<void>((resolvePromise, reject) => server.close((error) => error === undefined ? resolvePromise() : reject(error))),
	};
}

function controlledOutputs(entry: LoadedEvaluationReferenceCorpusEntry): Record<ProductionModelStep, string> {
	const sourceClaim = claimTemplate(entry);
	const story = { title: "Regional Notes", subtitle: "Source record", main_story: { headline: "Source record", lede: "Human-annotated source evidence.", body: sourceClaim.body } };
	const noteworthy = entry.reference.noteworthy_candidates[0];
	const announcements = noteworthy === undefined ? [] : [{ title: "Regional notice", summary: noteworthy.witnesses[0]!.excerpt }];
	return {
		main_story_write: JSON.stringify(story),
		main_story_copyedit: JSON.stringify(story),
		announcements_write: JSON.stringify({ announcements }),
		announcements_copyedit: JSON.stringify({ announcements: announcements.map((announcement, index) => ({ id: `announcement-${String(index + 1)}`, ...announcement })) }),
	};
}

function outputIdentity(run: V7BenchmarkRun, runSha256: string, entry: LoadedEvaluationReferenceCorpusEntry, invocation: V7BenchmarkRun["trials"][number]["invocations"][number], manifestId: string, manifestSha256: string): JsonObject {
	assertProof(invocation.transport === "succeeded" && invocation.parse.state === "succeeded", "Controlled scorecard invocation did not parse successfully");
	const runtime = run.runtime_evidence.find(({ invocation_id }) => invocation_id === invocation.id);
	assertProof(runtime?.state === "captured", `Controlled scorecard invocation ${invocation.id} lacks captured runtime evidence`);
	const trial = run.trials.find(({ id }) => id === runtime.trial_id)!;
	return {
		benchmark_run_id: run.id, benchmark_run_version: 7, benchmark_run_sha256: runSha256,
		code_commit_sha: run.provenance.code.commit_sha, fixture_sha256: run.fixture.fixture_sha256,
		prepared_evidence_identity_sha256: run.prepared_evidence.identity_sha256,
		corpus_manifest_id: manifestId, corpus_manifest_sha256: manifestSha256,
		corpus_fixture_id: entry.manifestEntry.id, reference_sha256: entry.manifestEntry.reference_sha256,
		config_identity: invocation.config_identity, trial_id: trial.id, repetition: trial.repetition,
		invocation_id: invocation.id, production_step: invocation.production_step, invocation_ordinal: invocation.ordinal,
		request_sha256: invocation.request_sha256, completion_text_sha256: hash(invocation.completion.text),
		parsed_output_sha256: canonicalHash(invocation.parse.output), runtime_evidence_sha256: canonicalHash(runtime.evidence),
	};
}

function span(pointer: string, excerpt: string): JsonObject {
	return { json_pointer: pointer, start_utf16: 0, end_utf16: excerpt.length, excerpt };
}

function annotation(entry: LoadedEvaluationReferenceCorpusEntry, output: JsonObject, step: ProductionModelStep, ordinal: number): JsonObject {
	const sourceClaim = claimTemplate(entry);
	const storyRole = step === "main_story_write" || step === "main_story_copyedit";
	const noteworthy = entry.reference.noteworthy_candidates[0];
	const excerpt = storyRole ? sourceClaim.body : noteworthy?.witnesses[0]?.excerpt;
	const claim = excerpt === undefined ? [] : [{
		id: `observed-claim-${String(ordinal)}`, proposition: storyRole ? sourceClaim.proposition : excerpt, atomic_proposition: true,
		spans: [span(storyRole ? "/main_story/body" : "/announcements/0/summary", excerpt)],
		references: [{ reference_id: storyRole ? sourceClaim.referenceId : `noteworthy:${noteworthy!.id}`, relation: storyRole ? sourceClaim.relation : "supports" }],
		grounding: storyRole ? sourceClaim.grounding : "grounded", attribution_requirement: storyRole ? "required" : "not_required", attribution: storyRole ? "present" : "not_applicable",
		rationale: "A human annotation binds the exact output span to the cited fixture reference.", uncertainty: "low",
	}];
	return {
		annotation_id: `annotation-${entry.manifestEntry.id}-${step}`, output,
		factual_claim_inventory_complete: true, factual_claims: claim,
		event_coverage: entry.reference.events.map((event) => storyRole && sourceClaim.referenceId === `event:${event.id}`
			? { event_id: event.id, assessment: "covered", spans: [span("/main_story/body", sourceClaim.body)], rationale: "The exact story span communicates this source event.", uncertainty: "low" }
			: { event_id: event.id, assessment: "not_covered", spans: [], rationale: "This controlled output does not cover the source event.", uncertainty: "low" }),
		announcement_relevance: storyRole ? { state: "not_applicable" } : noteworthy === undefined
			? { state: "assessed", announcements: [] }
			: { state: "assessed", announcements: [{ announcement_index: 0, assessment: "relevant", noteworthy_reference_ids: [`noteworthy:${noteworthy.id}`], rationale: "The exact summary span communicates the cited noteworthy candidate.", uncertainty: "low" }] },
	};
}

function review(entry: LoadedEvaluationReferenceCorpusEntry, output: JsonObject, step: ProductionModelStep): JsonObject {
	return {
		review_id: `review-${entry.manifestEntry.id}-${step}`, output,
		criteria: ["coherence", "usefulness", "newsworthiness", "voice"].map((criterion) => ({
			criterion, assessment: "meets", rationale: `Human reviewer assessed ${criterion} against rubric version 1.`, uncertainty: "low",
		})),
	};
}

export async function buildControlledEvaluationScorecardInput(root: string, manifestPath: string): Promise<{ declarationPath: string; createdAt: string }> {
	const corpus = await loadEvaluationReferenceCorpus(manifestPath);
	const resultsDirectory = join(root, "benchmark-results");
	const configPath = join(root, "benchmark.config.json");
	await mkdir(resultsDirectory, { recursive: true });
	await writeFile(configPath, json(verifierConfiguration()), "utf8");
	const runs: Array<{ run: V7BenchmarkRun; sha256: string; entry: LoadedEvaluationReferenceCorpusEntry }> = [];
	for (const [entryIndex, entry] of corpus.entries.entries()) {
		const outputs = controlledOutputs(entry);
		if (entryIndex === 2) outputs.main_story_write = "{controlled-invalid-json";
		if (entryIndex === 3) outputs.announcements_write = JSON.stringify({ announcements: [{ title: "missing summary" }] });
		const server = entryIndex === 1
			? await startControlledFailureServer()
			: await startRecordLoopbackServer(Object.fromEntries(PRODUCTION_MODEL_STEPS.map((step) => [`scorecard/${step}`, outputs[step]])));
		try {
			const result = await evaluateBenchmarkCommand({ fixturePath: entry.evidencePath, configPath, resultsDirectory, environment: { HOSTED_MODEL_BASE_URL: server.baseUrl, HOSTED_MODEL_API_KEY: "record-loopback-proof" }, sourceProvenance: SOURCE_PROVENANCE });
			const bytes = await readFile(result.path);
			runs.push({ run: result.benchmark, sha256: hash(bytes), entry });
		} finally { await server.close(); }
	}
	const latestCompletion = Math.max(...runs.map(({ run }) => Date.parse(run.completed_at!)));
	const annotatedAt = new Date(latestCompletion + 1).toISOString();
	const reviewedAt = new Date(latestCompletion + 2).toISOString();
	const createdAt = new Date(latestCompletion + 3).toISOString();
	const outputs = runs.flatMap(({ run, sha256, entry }) => run.trials.flatMap(({ invocations }) => invocations
		.filter((invocation) => invocation.transport === "succeeded" && invocation.parse.state === "succeeded")
		.map((invocation) => ({ entry, step: invocation.production_step, identity: outputIdentity(run, sha256, entry, invocation, corpus.manifest.id, corpus.manifestSha256) }))));
	const annotations = { version: 1, protocol: { id: "bc-news-output-annotation", version: 1 }, annotator: { id: "repository-human-annotator", kind: "human" }, annotated_at: annotatedAt, outputs: outputs.map(({ entry, identity, step }, index) => annotation(entry, identity, step, index + 1)) };
	const reviews = { version: 1, rubric: { id: "bc-news-editorial-qualitative", version: 1 }, reviewer: { id: "repository-human-reviewer", kind: "human" }, reviewed_at: reviewedAt, reviews: outputs.map(({ entry, identity, step }) => review(entry, identity, step)) };
	const annotationPath = join(root, "annotations.json");
	const reviewPath = join(root, "reviews.json");
	const annotationBytes = json(annotations);
	const reviewBytes = json(reviews);
	await Promise.all([writeFile(annotationPath, annotationBytes, "utf8"), writeFile(reviewPath, reviewBytes, "utf8")]);
	const declarationPath = join(root, "scorecard-input.json");
	const declaration = {
		version: 1, id: "controlled-evaluation-scorecard-input",
		corpus: { manifest_path: relative(root, manifestPath), manifest_sha256: corpus.manifestSha256 },
		benchmark_results_directory: relative(root, resultsDirectory),
		configuration_identity: runs[0]!.run.declaration.configurations[0]!.identity,
		runs: runs.map(({ run, sha256, entry }, index) => ({ ordinal: index + 1, corpus_fixture_id: entry.manifestEntry.id, benchmark_run_id: run.id, benchmark_run_sha256: sha256 })),
		annotations: { path: relative(root, annotationPath), sha256: hash(annotationBytes) },
		qualitative_reviews: { path: relative(root, reviewPath), sha256: hash(reviewBytes) },
	};
	await writeFile(declarationPath, json(declaration), "utf8");
	return { declarationPath, createdAt };
}

async function expectCode(operation: () => unknown, expected: string): Promise<void> {
	try { await operation(); }
	catch (error) {
		if (error instanceof EvaluationScorecardError && error.code === expected) return;
		throw new Error(`Expected evaluation scorecard error ${expected}, received ${error instanceof EvaluationScorecardError ? error.code : String(error)}`, { cause: error });
	}
	throw new Error(`Expected evaluation scorecard error ${expected}, but the mutation succeeded`);
}

async function expectDeclarationMutation(
	declarationPath: string,
	expected: string,
	mutate: (declaration: JsonObject) => void,
): Promise<void> {
	const original = await readFile(declarationPath);
	try {
		const declaration = JSON.parse(original.toString("utf8")) as JsonObject;
		mutate(declaration);
		await writeFile(declarationPath, json(declaration), "utf8");
		await expectCode(() => loadEvaluationScorecardInput(declarationPath), expected);
	} finally { await writeFile(declarationPath, original); }
}

async function expectBundleMutation(
	declarationPath: string,
	key: "annotations" | "qualitative_reviews",
	expected: string,
	mutate: (bundle: JsonObject) => void,
): Promise<void> {
	const declarationBytes = await readFile(declarationPath);
	const declaration = JSON.parse(declarationBytes.toString("utf8")) as JsonObject;
	const descriptor = declaration[key] as { path: string; sha256: string };
	const bundlePath = resolve(dirname(declarationPath), descriptor.path);
	const bundleBytes = await readFile(bundlePath);
	try {
		const bundle = JSON.parse(bundleBytes.toString("utf8")) as JsonObject;
		mutate(bundle);
		const mutatedBytes = json(bundle);
		await writeFile(bundlePath, mutatedBytes, "utf8");
		descriptor.sha256 = hash(mutatedBytes);
		await writeFile(declarationPath, json(declaration), "utf8");
		await expectCode(() => loadEvaluationScorecardInput(declarationPath), expected);
	} finally {
		await Promise.all([writeFile(bundlePath, bundleBytes), writeFile(declarationPath, declarationBytes)]);
	}
}

async function expectRunBytesMutation(
	declarationPath: string,
	expected: string,
	mutate: (run: JsonObject) => string,
	runIndex = 0,
): Promise<void> {
	const declarationBytes = await readFile(declarationPath);
	const declaration = JSON.parse(declarationBytes.toString("utf8")) as JsonObject;
	const descriptor = (declaration.runs as JsonObject[])[runIndex]!;
	const resultsDirectory = resolve(dirname(declarationPath), String(declaration.benchmark_results_directory));
	const runPath = join(resultsDirectory, `${String(descriptor.benchmark_run_id)}.json`);
	const runBytes = await readFile(runPath);
	try {
		const mutatedBytes = mutate(JSON.parse(runBytes.toString("utf8")) as JsonObject);
		await writeFile(runPath, mutatedBytes, "utf8");
		descriptor.benchmark_run_sha256 = hash(mutatedBytes);
		await writeFile(declarationPath, json(declaration), "utf8");
		await expectCode(() => loadEvaluationScorecardInput(declarationPath), expected);
	} finally {
		await Promise.all([writeFile(runPath, runBytes), writeFile(declarationPath, declarationBytes)]);
	}
}

async function expectRunMutation(declarationPath: string, expected: string, mutate: (run: JsonObject) => void, runIndex = 0): Promise<void> {
	await expectRunBytesMutation(declarationPath, expected, (run) => {
		mutate(run);
		return json(run);
	}, runIndex);
}

async function rejectedInvocationIdentity(declarationPath: string): Promise<JsonObject> {
	const declaration = JSON.parse(await readFile(declarationPath, "utf8")) as JsonObject;
	const resultsDirectory = resolve(dirname(declarationPath), String(declaration.benchmark_results_directory));
	for (const descriptor of declaration.runs as JsonObject[]) {
		const run = JSON.parse(await readFile(join(resultsDirectory, `${String(descriptor.benchmark_run_id)}.json`), "utf8")) as JsonObject;
		for (const trial of run.trials as JsonObject[]) {
			const invocation = (trial.invocations as JsonObject[]).find((candidate) => candidate.transport === "succeeded" && (candidate.parse as JsonObject).state === "rejected");
			if (invocation === undefined) continue;
			const runtime = (run.runtime_evidence as JsonObject[]).find((candidate) => candidate.invocation_id === invocation.id)!;
			const completion = invocation.completion as JsonObject;
			return {
				benchmark_run_id: run.id, benchmark_run_sha256: descriptor.benchmark_run_sha256,
				code_commit_sha: ((run.provenance as JsonObject).code as JsonObject).commit_sha,
				fixture_sha256: (run.fixture as JsonObject).fixture_sha256,
				prepared_evidence_identity_sha256: (run.prepared_evidence as JsonObject).identity_sha256,
				config_identity: invocation.config_identity, trial_id: trial.id, repetition: trial.repetition,
				invocation_id: invocation.id, production_step: invocation.production_step, invocation_ordinal: invocation.ordinal,
				request_sha256: invocation.request_sha256, completion_text_sha256: hash(String(completion.text)),
				parsed_output_sha256: "0".repeat(64), runtime_evidence_sha256: canonicalHash(runtime.evidence as object),
			};
		}
	}
	throw new Error("Controlled scorecard input lacks a parse-rejected invocation");
}

async function proveExecutionContextMixing(declarationPath: string): Promise<void> {
	const declarationBytes = await readFile(declarationPath);
	const declaration = JSON.parse(declarationBytes.toString("utf8")) as JsonObject;
	const descriptor = (declaration.runs as JsonObject[])[0]!;
	const resultsDirectory = resolve(dirname(declarationPath), String(declaration.benchmark_results_directory));
	const runPath = join(resultsDirectory, `${String(descriptor.benchmark_run_id)}.json`);
	const annotationDescriptor = declaration.annotations as { path: string; sha256: string };
	const reviewDescriptor = declaration.qualitative_reviews as { path: string; sha256: string };
	const annotationPath = resolve(dirname(declarationPath), annotationDescriptor.path);
	const reviewPath = resolve(dirname(declarationPath), reviewDescriptor.path);
	const [runBytes, annotationBytes, reviewBytes] = await Promise.all([readFile(runPath), readFile(annotationPath), readFile(reviewPath)]);
	try {
		const run = JSON.parse(runBytes.toString("utf8")) as JsonObject;
		const runtime = (run.runtime_evidence as JsonObject[]).find((record) => record.state === "captured")!;
		const invocation = (run.trials as JsonObject[]).flatMap((trial) => trial.invocations as JsonObject[]).find((candidate) => candidate.id === runtime.invocation_id)!;
		const evidence = runtime.evidence as JsonObject;
		const responseModel = (((evidence.execution_context as JsonObject).response_model as JsonObject).identifier as JsonObject);
		responseModel.value = "controlled-context-variant";
		(invocation.completion as JsonObject).model = "controlled-context-variant";
		const changedRunBytes = json(run);
		const changedRunSha = hash(changedRunBytes);
		const changedRuntimeSha = canonicalHash(evidence);
		const updateBundle = (bytes: Buffer, collection: "outputs" | "reviews"): string => {
			const bundle = JSON.parse(bytes.toString("utf8")) as JsonObject;
			for (const item of bundle[collection] as JsonObject[]) {
				const output = item.output as JsonObject;
				if (output.benchmark_run_id !== run.id) continue;
				output.benchmark_run_sha256 = changedRunSha;
				if (output.invocation_id === runtime.invocation_id) output.runtime_evidence_sha256 = changedRuntimeSha;
			}
			return json(bundle);
		};
		const changedAnnotations = updateBundle(annotationBytes, "outputs");
		const changedReviews = updateBundle(reviewBytes, "reviews");
		descriptor.benchmark_run_sha256 = changedRunSha;
		annotationDescriptor.sha256 = hash(changedAnnotations);
		reviewDescriptor.sha256 = hash(changedReviews);
		await Promise.all([
			writeFile(runPath, changedRunBytes, "utf8"), writeFile(annotationPath, changedAnnotations, "utf8"),
			writeFile(reviewPath, changedReviews, "utf8"), writeFile(declarationPath, json(declaration), "utf8"),
		]);
		await expectCode(async () => {
			const loaded = await loadEvaluationScorecardInput(declarationPath);
			buildEvaluationScorecard(loaded, { id: "mixed-context-scorecard", createdAt: new Date(Date.now() + 60_000).toISOString() });
		}, "execution_context_mismatch");
	} finally {
		await Promise.all([
			writeFile(runPath, runBytes), writeFile(annotationPath, annotationBytes),
			writeFile(reviewPath, reviewBytes), writeFile(declarationPath, declarationBytes),
		]);
	}
}

async function proveUnavailableTokenUsage(declarationPath: string, createdAt: string, root: string): Promise<void> {
	const declarationBytes = await readFile(declarationPath);
	const declaration = JSON.parse(declarationBytes.toString("utf8")) as JsonObject;
	const resultsDirectory = resolve(dirname(declarationPath), String(declaration.benchmark_results_directory));
	const annotationDescriptor = declaration.annotations as { path: string; sha256: string };
	const reviewDescriptor = declaration.qualitative_reviews as { path: string; sha256: string };
	const annotationPath = resolve(dirname(declarationPath), annotationDescriptor.path);
	const reviewPath = resolve(dirname(declarationPath), reviewDescriptor.path);
	const descriptors = declaration.runs as JsonObject[];
	const runBackups = await Promise.all(descriptors.map(async (descriptor) => {
		const path = join(resultsDirectory, `${String(descriptor.benchmark_run_id)}.json`);
		return { path, bytes: await readFile(path) };
	}));
	const [annotationBytes, reviewBytes] = await Promise.all([readFile(annotationPath), readFile(reviewPath)]);
	try {
		const localConfig = {
			production_steps: Object.fromEntries(PRODUCTION_MODEL_STEPS.map((step) => [step, {
				adapter: "lmstudio", model: `scorecard/${step}`, reasoning_effort: "provider_default",
			}])) as Record<ProductionModelStep, object>,
		};
		const configIdentity = evaluationConfigIdentity(localConfig);
		declaration.configuration_identity = configIdentity;
		const changedRunHashes = new Map<string, string>();
		const changedRunWrites: Array<Promise<void>> = [];
		for (const [index, backup] of runBackups.entries()) {
			const descriptor = descriptors[index]!;
			const run = JSON.parse(backup.bytes.toString("utf8")) as JsonObject;
			((run.declaration as JsonObject).configurations as JsonObject[])[0] = { identity: configIdentity, config: localConfig };
			for (const roster of run.trial_roster as JsonObject[]) roster.config_identity = configIdentity;
			for (const trial of run.trials as JsonObject[]) {
				trial.config_identity = configIdentity;
				for (const invocation of trial.invocations as JsonObject[]) {
					invocation.config_identity = configIdentity;
					if (invocation.transport !== "succeeded") continue;
					const completion = invocation.completion as JsonObject;
					completion.provider = "lmstudio";
					completion.execution = "local_inference";
					completion.token_usage = { measurement: "unavailable" };
					completion.external_billing = { classification: "none", amount_usd: 0, reason: "local_inference" };
				}
			}
			for (const runtime of run.runtime_evidence as JsonObject[]) runtime.config_identity = configIdentity;
			const changedBytes = json(run);
			const changedSha = hash(changedBytes);
			descriptor.benchmark_run_sha256 = changedSha;
			changedRunHashes.set(String(run.id), changedSha);
			changedRunWrites.push(writeFile(backup.path, changedBytes, "utf8"));
		}
		const updateBundle = (bytes: Buffer, collection: "outputs" | "reviews"): string => {
			const bundle = JSON.parse(bytes.toString("utf8")) as JsonObject;
			for (const item of bundle[collection] as JsonObject[]) {
				const output = item.output as JsonObject;
				const changedSha = changedRunHashes.get(String(output.benchmark_run_id));
				assertProof(changedSha !== undefined, "Unavailable token proof lost an annotated run identity");
				output.benchmark_run_sha256 = changedSha;
				output.config_identity = configIdentity;
			}
			return json(bundle);
		};
		const changedAnnotations = updateBundle(annotationBytes, "outputs");
		const changedReviews = updateBundle(reviewBytes, "reviews");
		annotationDescriptor.sha256 = hash(changedAnnotations);
		reviewDescriptor.sha256 = hash(changedReviews);
		await Promise.all([
			...changedRunWrites, writeFile(annotationPath, changedAnnotations, "utf8"),
			writeFile(reviewPath, changedReviews, "utf8"), writeFile(declarationPath, json(declaration), "utf8"),
		]);
		const loaded = await loadEvaluationScorecardInput(declarationPath);
		const artifact = buildEvaluationScorecard(loaded, { id: "unavailable-token-scorecard", createdAt });
		const tokenDistributions = artifact.scorecards.flatMap(({ distributions }) => distributions)
			.filter(({ metric }) => metric === "input_tokens" || metric === "output_tokens" || metric === "total_tokens");
		assertProof(tokenDistributions.some(({ unavailable_sample_count }) => unavailable_sample_count > 0), "Unavailable token usage was not retained explicitly");
		await expectArtifactTamper(artifact, root, 100, (candidate) => {
			const distribution = candidate.scorecards.flatMap(({ distributions }) => distributions)
				.find(({ metric, unavailable_sample_count }) => metric === "input_tokens" && unavailable_sample_count > 0);
			assertProof(distribution !== undefined, "Unavailable token distribution disappeared before zero-fabrication proof");
			distribution.unavailable_sample_count -= 1;
			distribution.observed_sample_count += 1;
			distribution.samples.push({ run_id: "fabricated-run", trial_id: "fabricated-trial", invocation_id: "fabricated-invocation", value: 0 });
		});
	} finally {
		await Promise.all([
			...runBackups.map(({ path, bytes }) => writeFile(path, bytes)), writeFile(annotationPath, annotationBytes),
			writeFile(reviewPath, reviewBytes), writeFile(declarationPath, declarationBytes),
		]);
	}
}

async function proveInputCorruptionCodes(declarationPath: string): Promise<void> {
	const rejectedIdentity = await rejectedInvocationIdentity(declarationPath);
	await proveExecutionContextMixing(declarationPath);
	await expectRunBytesMutation(declarationPath, "benchmark_artifact_malformed", () => "{not-json\n");
	await expectRunMutation(declarationPath, "benchmark_filename_mismatch", (run) => { run.id = "detached-benchmark-id"; });
	await expectRunMutation(declarationPath, "unsupported_benchmark_version", (run) => { run.version = 6; delete run.runtime_evidence; });
	await expectRunMutation(declarationPath, "benchmark_artifact_invalid", (run) => { run.version = 6; });
	await expectRunMutation(declarationPath, "benchmark_not_complete", (run) => { run.lifecycle = "running"; run.completed_at = null; run.harness_outcome = "pending"; });
	await expectRunMutation(declarationPath, "benchmark_not_retained", (run) => { run.harness_outcome = "pending"; });
	await expectRunMutation(declarationPath, "corpus_binding_mismatch", (run) => { (run.fixture as JsonObject).fixture_sha256 = "0".repeat(64); });
	await expectRunMutation(declarationPath, "corpus_binding_mismatch", (run) => { (run.prepared_evidence as JsonObject).identity_sha256 = "0".repeat(64); });
	await expectRunMutation(declarationPath, "configuration_mismatch", (run) => {
		const configuration = (((run.declaration as JsonObject).configurations as JsonObject[])[0]!.config as JsonObject);
		const steps = configuration.production_steps as JsonObject;
		((steps.main_story_write as JsonObject).model) = "changed/model";
	});
	await expectRunMutation(declarationPath, "repetition_mismatch", (run) => { (run.declaration as JsonObject).repetition_count = 2; }, 1);
	await expectRunMutation(declarationPath, "provenance_mismatch", (run) => { ((run.provenance as JsonObject).code as JsonObject).commit_sha = "9".repeat(40); });
	await expectRunMutation(declarationPath, "provenance_mismatch", (run) => {
		const contract = ((run.provenance as JsonObject).output_contracts as JsonObject[])[0]!;
		contract.schema_sha256 = "0".repeat(64);
	});
	await expectRunMutation(declarationPath, "evidence_set_mismatch", (run) => { (run.runtime_evidence as JsonObject[]).pop(); });
	await expectRunMutation(declarationPath, "evidence_set_mismatch", (run) => {
		const roster = run.runtime_evidence as JsonObject[];
		roster[1] = structuredClone(roster[0]!);
	});
	await expectRunMutation(declarationPath, "evidence_set_mismatch", (run) => {
		const roster = run.runtime_evidence as JsonObject[];
		[roster[0], roster[1]] = [roster[1]!, roster[0]!];
	});
	await expectRunMutation(declarationPath, "output_identity_mismatch", (run) => { (run.runtime_evidence as JsonObject[])[0]!.invocation_id = "detached-invocation"; });
	await expectDeclarationMutation(declarationPath, "declaration_rejected", (declaration) => { declaration.overall = "forbidden"; });
	await expectDeclarationMutation(declarationPath, "source_hash_mismatch", (declaration) => {
		(declaration.annotations as JsonObject).sha256 = "0".repeat(64);
	});
	await expectDeclarationMutation(declarationPath, "source_hash_mismatch", (declaration) => {
		((declaration.runs as JsonObject[])[0]!).benchmark_run_sha256 = "0".repeat(64);
	});
	await expectDeclarationMutation(declarationPath, "evidence_set_mismatch", (declaration) => { (declaration.runs as JsonObject[]).pop(); });
	await expectDeclarationMutation(declarationPath, "evidence_set_mismatch", (declaration) => {
		const runs = declaration.runs as JsonObject[];
		runs.push({ ...structuredClone(runs[0]!), ordinal: runs.length + 1 });
	});
	await expectDeclarationMutation(declarationPath, "evidence_set_mismatch", (declaration) => {
		const runs = declaration.runs as JsonObject[];
		[runs[0], runs[1]] = [runs[1]!, runs[0]!];
	});
	await expectDeclarationMutation(declarationPath, "configuration_mismatch", (declaration) => { declaration.configuration_identity = "detached-configuration"; });
	await expectBundleMutation(declarationPath, "annotations", "annotation_completeness_mismatch", (bundle) => { (bundle.outputs as JsonObject[]).pop(); });
	await expectBundleMutation(declarationPath, "annotations", "annotation_completeness_mismatch", (bundle) => {
		const outputs = bundle.outputs as JsonObject[];
		outputs.push(structuredClone(outputs[0]!));
	});
	await expectBundleMutation(declarationPath, "qualitative_reviews", "review_completeness_mismatch", (bundle) => { (bundle.reviews as JsonObject[]).pop(); });
	await expectBundleMutation(declarationPath, "qualitative_reviews", "review_completeness_mismatch", (bundle) => {
		const reviews = bundle.reviews as JsonObject[];
		reviews.push(structuredClone(reviews[0]!));
	});
	await expectBundleMutation(declarationPath, "annotations", "output_identity_mismatch", (bundle) => {
		((bundle.outputs as JsonObject[])[0]!.output as JsonObject).benchmark_run_id = "detached-run";
	});
	await expectBundleMutation(declarationPath, "annotations", "output_identity_mismatch", (bundle) => {
		((bundle.outputs as JsonObject[])[0]!.output as JsonObject).invocation_id = "fabricated-invocation";
	});
	await expectBundleMutation(declarationPath, "annotations", "output_identity_mismatch", (bundle) => {
		((bundle.outputs as JsonObject[])[0]!.output as JsonObject).completion_text_sha256 = "0".repeat(64);
	});
	await expectBundleMutation(declarationPath, "annotations", "output_identity_mismatch", (bundle) => {
		((bundle.outputs as JsonObject[])[0]!.output as JsonObject).parsed_output_sha256 = "0".repeat(64);
	});
	await expectBundleMutation(declarationPath, "annotations", "output_identity_mismatch", (bundle) => {
		((bundle.outputs as JsonObject[])[0]!.output as JsonObject).runtime_evidence_sha256 = "0".repeat(64);
	});
	await expectBundleMutation(declarationPath, "annotations", "annotation_completeness_mismatch", (bundle) => {
		const outputs = bundle.outputs as JsonObject[];
		const base = outputs.find((candidate) => (candidate.output as JsonObject).benchmark_run_id === rejectedIdentity.benchmark_run_id)!;
		outputs.push({ ...structuredClone(base), annotation_id: "annotation-for-rejected-output", output: { ...(base.output as JsonObject), ...rejectedIdentity }, factual_claims: [], announcement_relevance: { state: "not_applicable" } });
	});
	await expectBundleMutation(declarationPath, "qualitative_reviews", "review_completeness_mismatch", (bundle) => {
		const reviews = bundle.reviews as JsonObject[];
		const base = reviews.find((candidate) => (candidate.output as JsonObject).benchmark_run_id === rejectedIdentity.benchmark_run_id)!;
		reviews.push({ ...structuredClone(base), review_id: "review-for-rejected-output", output: { ...(base.output as JsonObject), ...rejectedIdentity } });
	});
	await expectBundleMutation(declarationPath, "annotations", "span_mismatch", (bundle) => {
		const claim = (((bundle.outputs as JsonObject[])[0]!.factual_claims as JsonObject[])[0]!);
		((claim.spans as JsonObject[])[0]!).excerpt = `${String((claim.spans as JsonObject[])[0]!.excerpt)} changed`;
	});
	await expectBundleMutation(declarationPath, "annotations", "span_mismatch", (bundle) => {
		const claim = (((bundle.outputs as JsonObject[])[0]!.factual_claims as JsonObject[])[0]!);
		((claim.spans as JsonObject[])[0]!).json_pointer = "/missing";
	});
	await expectBundleMutation(declarationPath, "annotations", "span_mismatch", (bundle) => {
		const claim = (((bundle.outputs as JsonObject[])[0]!.factual_claims as JsonObject[])[0]!);
		((claim.spans as JsonObject[])[0]!).end_utf16 = 999_999;
	});
	await expectBundleMutation(declarationPath, "annotations", "span_mismatch", (bundle) => {
		const claims = (bundle.outputs as JsonObject[]).flatMap((output) => output.factual_claims as JsonObject[]);
		const claim = claims.find((candidate) => String(((candidate.spans as JsonObject[])[0]!).excerpt).includes("😀"));
		assertProof(claim !== undefined, "Controlled annotations lack a surrogate-pair span");
		const target = (claim.spans as JsonObject[])[0]!;
		const excerpt = String(target.excerpt);
		const highSurrogate = excerpt.indexOf("😀");
		target.end_utf16 = highSurrogate + 1;
		target.excerpt = excerpt.slice(0, highSurrogate + 1);
	});
	await expectBundleMutation(declarationPath, "annotations", "reference_mismatch", (bundle) => {
		const claim = (((bundle.outputs as JsonObject[])[0]!.factual_claims as JsonObject[])[0]!);
		((claim.references as JsonObject[])[0]!).reference_id = "claim:missing-reference";
	});
	await expectBundleMutation(declarationPath, "annotations", "reference_mismatch", (bundle) => {
		const claim = (((bundle.outputs as JsonObject[])[0]!.factual_claims as JsonObject[])[0]!);
		((claim.references as JsonObject[])[0]!).reference_id = "event:moss-bridge-repair";
	});
	await expectBundleMutation(declarationPath, "annotations", "relation_mismatch", (bundle) => {
		const claim = (((bundle.outputs as JsonObject[])[0]!.factual_claims as JsonObject[])[0]!);
		claim.grounding = "not_grounded";
	});
	await expectBundleMutation(declarationPath, "annotations", "relation_mismatch", (bundle) => {
		const claim = (((bundle.outputs as JsonObject[])[0]!.factual_claims as JsonObject[])[0]!);
		claim.references = [];
	});
	await expectBundleMutation(declarationPath, "annotations", "relation_mismatch", (bundle) => {
		const claim = (((bundle.outputs as JsonObject[])[0]!.factual_claims as JsonObject[])[0]!);
		claim.attribution_requirement = "required";
		claim.attribution = "not_applicable";
	});
	await expectBundleMutation(declarationPath, "annotations", "relation_mismatch", (bundle) => {
		const outputs = bundle.outputs as JsonObject[];
		const qualified = outputs.find((output) => ((output.factual_claims as JsonObject[])[0]?.references as JsonObject[] | undefined)?.some(({ relation }) => relation === "supports_status_qualified"));
		assertProof(qualified !== undefined, "Controlled annotations lack status-qualified evidence");
		const claim = (qualified.factual_claims as JsonObject[])[0]!;
		((claim.references as JsonObject[])[0]!).relation = "supports";
	});
	await expectBundleMutation(declarationPath, "annotations", "annotation_completeness_mismatch", (bundle) => {
		const output = (bundle.outputs as JsonObject[]).find((candidate) => (candidate.event_coverage as JsonObject[]).length > 0);
		assertProof(output !== undefined, "Controlled annotations lack an event denominator");
		(output.event_coverage as JsonObject[]).pop();
	});
	await expectBundleMutation(declarationPath, "annotations", "annotation_completeness_mismatch", (bundle) => {
		const output = (bundle.outputs as JsonObject[]).find((candidate) => {
			const relevance = candidate.announcement_relevance as JsonObject;
			return relevance.state === "assessed" && (relevance.announcements as JsonObject[]).length > 0;
		});
		assertProof(output !== undefined, "Controlled annotations lack an announcement denominator");
		const announcements = ((output.announcement_relevance as JsonObject).announcements as JsonObject[]);
		announcements.push(structuredClone(announcements[0]!));
	});
	await expectBundleMutation(declarationPath, "annotations", "annotation_completeness_mismatch", (bundle) => {
		const output = (bundle.outputs as JsonObject[])[0]!;
		const claims = output.factual_claims as JsonObject[];
		claims.push({ ...structuredClone(claims[0]!), id: "duplicate-span-claim" });
	});
	await expectBundleMutation(declarationPath, "annotations", "reference_mismatch", (bundle) => {
		const claim = ((bundle.outputs as JsonObject[])[0]!.factual_claims as JsonObject[])[0]!;
		const references = claim.references as JsonObject[];
		references.push(structuredClone(references[0]!));
	});
	await expectBundleMutation(declarationPath, "annotations", "annotation_completeness_mismatch", (bundle) => {
		const claims = ((bundle.outputs as JsonObject[])[0]!.factual_claims as JsonObject[]);
		const duplicate = structuredClone(claims[0]!);
		const originalSpan = (duplicate.spans as JsonObject[])[0]!;
		const excerpt = String(originalSpan.excerpt);
		duplicate.proposition = `${String(duplicate.proposition)} second proposition`;
		duplicate.spans = [{ ...originalSpan, end_utf16: 1, excerpt: excerpt.slice(0, 1) }];
		claims.push(duplicate);
	});
	await expectBundleMutation(declarationPath, "annotations", "annotation_completeness_mismatch", (bundle) => {
		const claims = ((bundle.outputs as JsonObject[])[0]!.factual_claims as JsonObject[]);
		const duplicate = structuredClone(claims[0]!);
		const originalSpan = (duplicate.spans as JsonObject[])[0]!;
		const excerpt = String(originalSpan.excerpt);
		duplicate.id = "normalized-proposition-duplicate";
		duplicate.proposition = String(duplicate.proposition).toUpperCase();
		duplicate.spans = [{ ...originalSpan, start_utf16: 1, end_utf16: 2, excerpt: excerpt.slice(1, 2) }];
		claims.push(duplicate);
	});
	await expectBundleMutation(declarationPath, "annotations", "annotation_completeness_mismatch", (bundle) => {
		const claim = ((bundle.outputs as JsonObject[])[0]!.factual_claims as JsonObject[])[0]!;
		const spans = claim.spans as JsonObject[];
		spans.push(structuredClone(spans[0]!));
	});
	await expectBundleMutation(declarationPath, "annotations", "annotation_completeness_mismatch", (bundle) => {
		const output = (bundle.outputs as JsonObject[]).find((candidate) => {
			const relevance = candidate.announcement_relevance as JsonObject;
			return relevance.state === "assessed" && (relevance.announcements as JsonObject[]).some((announcement) => (announcement.noteworthy_reference_ids as string[]).length > 0);
		});
		assertProof(output !== undefined, "Controlled annotations lack noteworthy announcement evidence");
		const announcement = (((output.announcement_relevance as JsonObject).announcements as JsonObject[])[0]!);
		const ids = announcement.noteworthy_reference_ids as string[];
		ids.push(ids[0]!);
	});
	await expectBundleMutation(declarationPath, "annotations", "annotation_completeness_mismatch", (bundle) => {
		const output = (bundle.outputs as JsonObject[])[0]!;
		output.announcement_relevance = { state: "assessed", announcements: [] };
	});
	await expectBundleMutation(declarationPath, "annotations", "annotation_completeness_mismatch", (bundle) => {
		const output = (bundle.outputs as JsonObject[]).find((candidate) => (candidate.announcement_relevance as JsonObject).state === "assessed");
		assertProof(output !== undefined, "Controlled annotations lack announcement-role output");
		output.announcement_relevance = { state: "not_applicable" };
	});
	await expectBundleMutation(declarationPath, "annotations", "chronology_mismatch", (bundle) => { bundle.annotated_at = "2000-01-01T00:00:00.000Z"; });
	await expectBundleMutation(declarationPath, "qualitative_reviews", "chronology_mismatch", (bundle) => { bundle.reviewed_at = "2000-01-01T00:00:00.000Z"; });
	await expectBundleMutation(declarationPath, "qualitative_reviews", "review_bundle_rejected", (bundle) => {
		const review = (bundle.reviews as JsonObject[])[0]!;
		((review.criteria as JsonObject[])[0]!).weight = 1;
	});
	await expectBundleMutation(declarationPath, "qualitative_reviews", "review_bundle_rejected", (bundle) => {
		delete (bundle.reviewer as JsonObject).id;
	});
	await expectBundleMutation(declarationPath, "qualitative_reviews", "review_bundle_rejected", (bundle) => { (bundle.reviewer as JsonObject).kind = "model"; });
	await expectBundleMutation(declarationPath, "qualitative_reviews", "review_bundle_rejected", (bundle) => { delete (bundle.rubric as JsonObject).version; });
	await expectBundleMutation(declarationPath, "qualitative_reviews", "review_bundle_rejected", (bundle) => {
		const criteria = ((bundle.reviews as JsonObject[])[0]!.criteria as JsonObject[]);
		[criteria[0], criteria[1]] = [criteria[1]!, criteria[0]!];
	});
	await expectBundleMutation(declarationPath, "qualitative_reviews", "review_bundle_rejected", (bundle) => {
		((bundle.reviews as JsonObject[])[0]!.criteria as JsonObject[]).pop();
	});
	await expectBundleMutation(declarationPath, "qualitative_reviews", "review_bundle_rejected", (bundle) => {
		delete (((bundle.reviews as JsonObject[])[0]!.criteria as JsonObject[])[0]!).rationale;
	});
	await expectBundleMutation(declarationPath, "qualitative_reviews", "review_bundle_rejected", (bundle) => {
		delete (((bundle.reviews as JsonObject[])[0]!.criteria as JsonObject[])[0]!).uncertainty;
	});
	for (const forbidden of ["score", "numeric_score", "aggregate", "overall", "pass", "fail", "verdict", "winner", "threshold", "recommendation", "retry", "publication", "publication_decision", "production_selection"] as const) {
		await expectBundleMutation(declarationPath, "qualitative_reviews", "review_bundle_rejected", (bundle) => {
			(bundle.reviews as JsonObject[])[0]![forbidden] = forbidden === "numeric_score" || forbidden === "threshold" ? 1 : "forbidden";
		});
	}
}

async function expectArtifactTamper(artifact: EvaluationScorecardArtifact, root: string, ordinal: number, mutate: (candidate: EvaluationScorecardArtifact) => void): Promise<void> {
	const candidate = structuredClone(artifact);
	mutate(candidate);
	const directory = join(root, `derived-tamper-${String(ordinal)}`);
	await mkdir(directory);
	await writeFile(join(directory, `${String(candidate.id)}.json`), json(candidate), "utf8");
	await expectCode(() => loadEvaluationScorecardArtifact(String(candidate.id), directory), "artifact_tampered");
}

async function expectArtifactMutationCode(artifact: EvaluationScorecardArtifact, root: string, ordinal: number, expected: string, mutate: (candidate: EvaluationScorecardArtifact) => void): Promise<void> {
	const candidate = structuredClone(artifact);
	mutate(candidate);
	const directory = join(root, `derived-tamper-${String(ordinal)}`);
	await mkdir(directory);
	await writeFile(join(directory, `${String(candidate.id)}.json`), json(candidate), "utf8");
	await expectCode(() => loadEvaluationScorecardArtifact(String(candidate.id), directory), expected);
}

async function proveArtifactCorruptionCodes(artifact: EvaluationScorecardArtifact, root: string): Promise<void> {
	await expectArtifactTamper(artifact, root, 1, (candidate) => {
		const counts = candidate.scorecards[0]!.sample_counts;
		assertProof(counts.declared_trial_count !== undefined, "Controlled scorecard lacks declared-trial count");
		counts.declared_trial_count += 1;
	});
	await expectArtifactTamper(artifact, root, 2, (candidate) => {
		const rate = candidate.scorecards[0]!.rates.find(({ state }) => state === "measured");
		assertProof(rate?.state === "measured", "Controlled scorecard lacks a measured rate");
		rate.numerator -= 1;
	});
	await expectArtifactTamper(artifact, root, 3, (candidate) => {
		const distribution = candidate.scorecards[0]!.distributions.find(({ summary }) => summary.state === "measured");
		assertProof(distribution?.summary.state === "measured", "Controlled scorecard lacks a measured distribution");
		distribution.summary.mean += 1;
	});
	await expectArtifactTamper(artifact, root, 4, (candidate) => {
		candidate.scorecards[0]!.qualitative[0]!.counts.meets -= 1;
	});
	await expectArtifactTamper(artifact, root, 5, (candidate) => {
		candidate.source_payloads.declaration_base64 = Buffer.from("{}").toString("base64");
	});
	await expectArtifactTamper(artifact, root, 6, (candidate) => {
		const rate = candidate.scorecards[0]!.rates.find(({ state }) => state === "measured");
		assertProof(rate?.state === "measured", "Controlled scorecard lacks a measured Wilson interval");
		rate.interval.lower = Math.min(rate.interval.upper, rate.interval.lower + 0.01);
	});
	await expectArtifactTamper(artifact, root, 7, (candidate) => {
		const rate = candidate.scorecards[0]!.rates.find(({ state, scorecard_context }) => state === "measured" && scorecard_context.state === "identified");
		assertProof(rate?.state === "measured" && rate.scorecard_context.state === "identified", "Controlled scorecard lacks identified metric context");
		rate.scorecard_context.identity = "0".repeat(64);
	});
	await expectArtifactTamper(artifact, root, 8, (candidate) => {
		const distribution = candidate.scorecards.flatMap(({ distributions }) => distributions)
			.find(({ metric, unavailable_sample_count }) => metric.startsWith("provider_") && unavailable_sample_count > 0);
		assertProof(distribution !== undefined, "Controlled scorecard lacks unavailable provider timing");
		distribution.unavailable_sample_count -= 1;
		distribution.observed_sample_count += 1;
		distribution.samples.push({ run_id: "fabricated-run", trial_id: "fabricated-trial", invocation_id: "fabricated-invocation", value: 0 });
	});
	await expectArtifactTamper(artifact, root, 9, (candidate) => {
		const rate = candidate.scorecards[0]!.rates.find(({ state }) => state === "measured");
		assertProof(rate?.state === "measured", "Controlled scorecard lacks measured point value");
		rate.value = Math.max(0, rate.value - 0.01);
	});
	await expectArtifactTamper(artifact, root, 10, (candidate) => {
		const rate = candidate.scorecards[0]!.rates.find(({ state }) => state === "measured");
		assertProof(rate?.state === "measured", "Controlled scorecard lacks measured denominator");
		rate.denominator_unit = "human_annotated_factual_claim";
	});
	await expectArtifactTamper(artifact, root, 11, (candidate) => {
		const scorecard = candidate.scorecards[0]!;
		const application = scorecard.distributions.find(({ metric }) => metric === "application_latency_ms")!;
		const provider = scorecard.distributions.find(({ metric }) => metric === "provider_total_time_ms")!;
		application.samples = structuredClone(provider.samples);
		application.observed_sample_count = provider.observed_sample_count;
		application.unavailable_sample_count = provider.unavailable_sample_count;
		application.summary = structuredClone(provider.summary);
	});
	await expectArtifactTamper(artifact, root, 12, (candidate) => {
		const writer = candidate.scorecards.find(({ production_step }) => production_step === "main_story_write")!;
		const schema = writer.rates.find(({ metric, state }) => metric === "schema_reliability" && state === "measured");
		assertProof(schema?.state === "measured", "Controlled writer lacks measured schema rate");
		const index = writer.rates.findIndex(({ metric }) => metric === "copyedit_preservation");
		writer.rates[index] = { ...structuredClone(schema), metric: "copyedit_preservation", denominator_unit: "parse_success_copyedit_output" };
	});
	await expectArtifactTamper(artifact, root, 13, (candidate) => {
		const story = candidate.scorecards.find(({ production_step }) => production_step === "main_story_write")!;
		const schema = story.rates.find(({ metric, state }) => metric === "schema_reliability" && state === "measured");
		assertProof(schema?.state === "measured", "Controlled story lacks measured schema rate");
		const index = story.rates.findIndex(({ metric }) => metric === "announcement_relevance");
		story.rates[index] = { ...structuredClone(schema), metric: "announcement_relevance", denominator_unit: "parsed_announcement" };
	});
	const sourcePayloadMutations: Array<(candidate: EvaluationScorecardArtifact) => void> = [
		(candidate) => { candidate.source_payloads.corpus_manifest_base64 = Buffer.from("{}").toString("base64"); },
		(candidate) => { candidate.source_payloads.corpus_entries[0]!.evidence_base64 = Buffer.from("{}").toString("base64"); },
		(candidate) => { candidate.source_payloads.corpus_entries[0]!.reference_base64 = Buffer.from("{}").toString("base64"); },
		(candidate) => { candidate.source_payloads.benchmark_runs[0]!.bytes_base64 = Buffer.from("{}").toString("base64"); },
		(candidate) => { candidate.source_payloads.annotation_bundle_base64 = Buffer.from("{}").toString("base64"); },
		(candidate) => { candidate.source_payloads.qualitative_review_bundle_base64 = Buffer.from("{}").toString("base64"); },
	];
	for (const [index, mutate] of sourcePayloadMutations.entries()) await expectArtifactTamper(artifact, root, index + 14, mutate);
	const countKeys = [
		"declared_trial_count", "step_reached_trial_count", "step_not_reached_trial_count", "invocation_attempt_count",
		"initial_attempt_count", "retry_attempt_count", "transport_failed_attempt_count", "transport_succeeded_attempt_count",
		"parse_succeeded_invocation_count", "parse_rejected_invocation_count", "annotated_output_count", "reviewed_output_count",
	] as const;
	for (const [index, key] of countKeys.entries()) {
		await expectArtifactTamper(artifact, root, index + 20, (candidate) => {
			const scorecard = candidate.scorecards.find(({ sample_counts }) => (sample_counts[key] ?? 0) > 0);
			assertProof(scorecard !== undefined, `Controlled scorecard lacks positive ${key}`);
			const current = scorecard.sample_counts[key];
			assertProof(current !== undefined, `Controlled scorecard omitted ${key}`);
			scorecard.sample_counts[key] = current - 1;
		});
	}
	await expectArtifactTamper(artifact, root, 32, (candidate) => {
		const scorecard = candidate.scorecards.find(({ sample_counts }) => (sample_counts.transport_failed_attempt_count ?? 0) > 0);
		assertProof(scorecard !== undefined, "Controlled scorecard lacks transport failures for schema-denominator proof");
		const transportFailures = scorecard.sample_counts.transport_failed_attempt_count;
		assertProof(transportFailures !== undefined, "Controlled scorecard omitted transport failures");
		const rate = scorecard.rates.find(({ metric, state }) => metric === "schema_reliability" && state === "measured");
		assertProof(rate?.state === "measured", "Controlled transport-failure role lacks a measured schema rate");
		rate.denominator += transportFailures;
		rate.sample_count = rate.denominator;
		rate.value = rate.numerator / rate.denominator;
	});
	await expectArtifactMutationCode(artifact, root, 33, "scorecard_invalid", (candidate) => {
		candidate.source_payloads.declaration_base64 = `${candidate.source_payloads.declaration_base64}\n`;
	});
	await expectArtifactTamper(artifact, root, 34, (candidate) => {
		const reconstructed = JSON.parse(Buffer.from(candidate.source_payloads.declaration_base64, "base64").toString("utf8")) as JsonObject;
		reconstructed.id = "parseable-but-detached-declaration";
		candidate.source_payloads.declaration_base64 = Buffer.from(json(reconstructed)).toString("base64");
	});
	await expectArtifactTamper(artifact, root, 35, (candidate) => {
		candidate.declaration_sha256 = "0".repeat(64);
	});
}

const ORACLE_Z95 = 1.959963984540054;
const ORACLE_RATE_DEFINITIONS = [
	["schema_reliability", "terminal_provider_success_invocation"],
	["copyedit_preservation", "parse_success_copyedit_output"],
	["claim_grounding", "human_annotated_factual_claim"],
	["required_attribution", "human_annotated_required_attribution_claim"],
	["event_coverage", "source_event_output_pair"],
	["announcement_relevance", "parsed_announcement"],
] as const;
const ORACLE_DISTRIBUTIONS = ["input_tokens", "output_tokens", "total_tokens", "application_latency_ms", "provider_time_to_first_token_ms", "provider_total_time_ms"] as const;
const ORACLE_CRITERIA = ["coherence", "usefulness", "newsworthiness", "voice"] as const;

function oracleRoleEvidence(input: LoadedEvaluationScorecardInput, step: ProductionModelStep) {
	return input.runs.flatMap((loaded) => loaded.run.trials
		.filter(({ config_identity }) => config_identity === input.declaration.configuration_identity)
		.map((trial) => ({ loaded, trial, invocations: trial.invocations.filter(({ production_step }) => production_step === step) })));
}

function oracleContext(input: LoadedEvaluationScorecardInput, step: ProductionModelStep) {
	const evidence = oracleRoleEvidence(input, step);
	const contexts = evidence.flatMap(({ loaded, invocations }) => invocations.flatMap((invocation) => {
		if (invocation.transport !== "succeeded") return [];
		const runtime = loaded.run.runtime_evidence.find(({ invocation_id }) => invocation_id === invocation.id);
		assertProof(runtime?.state === "captured", `Oracle found no captured runtime for ${invocation.id}`);
		return [runtime.evidence.execution_context];
	}));
	if (contexts.length === 0) return { state: "unknown" as const, reason: "no_captured_invocation" as const };
	assertProof(contexts.every((candidate) => isDeepStrictEqual(candidate, contexts[0])), `Oracle found mixed execution contexts for ${step}`);
	const firstRun = input.runs[0]?.run;
	const config = firstRun?.declaration.configurations.find(({ identity }) => identity === input.declaration.configuration_identity)?.config;
	assertProof(firstRun !== undefined && config !== undefined, `Oracle found no selected configuration for ${step}`);
	const projection = {
		corpus_manifest_id: input.corpus.manifest.id,
		corpus_manifest_sha256: input.corpus.manifestSha256,
		fixture_prepared_identities: input.runs.map(({ run, declaration }) => ({
			fixture_id: declaration.corpus_fixture_id,
			fixture_sha256: run.fixture.fixture_sha256,
			prepared_evidence_identity_sha256: run.prepared_evidence.identity_sha256,
		})),
		code_provenance: firstRun.provenance.code,
		output_contract_provenance: firstRun.provenance.output_contracts,
		adapter: config.production_steps[step],
		request_hashes: evidence.flatMap(({ loaded, trial, invocations }) => invocations.map(({ request_sha256 }) => ({
			run_id: loaded.run.id, trial_id: trial.id, request_sha256,
		}))),
		execution_context: contexts[0]!,
	};
	return { state: "identified" as const, identity: `context-${canonicalHash(projection)}`, projection };
}

function oracleSampleCounts(input: LoadedEvaluationScorecardInput, step: ProductionModelStep) {
	const evidence = oracleRoleEvidence(input, step);
	let reached = 0; let attempts = 0; let initial = 0; let retries = 0; let failed = 0; let succeeded = 0; let parsed = 0; let rejected = 0;
	for (const { invocations } of evidence) {
		if (invocations.length > 0) reached += 1;
		attempts += invocations.length;
		for (const [index, invocation] of invocations.entries()) {
			if (index === 0) initial += 1; else retries += 1;
			if (invocation.transport === "failed") failed += 1;
			if (invocation.transport === "succeeded") {
				succeeded += 1;
				if (invocation.parse.state === "succeeded") parsed += 1;
				if (invocation.parse.state === "rejected") rejected += 1;
			}
		}
	}
	const annotated = input.annotations.outputs.filter(({ output }) => output.production_step === step).length;
	const reviewed = input.reviews.reviews.filter(({ output }) => output.production_step === step).length;
	const counts = {
		declared_trial_count: evidence.length, step_reached_trial_count: reached, step_not_reached_trial_count: evidence.length - reached,
		invocation_attempt_count: attempts, initial_attempt_count: initial, retry_attempt_count: retries,
		transport_failed_attempt_count: failed, transport_succeeded_attempt_count: succeeded,
		parse_succeeded_invocation_count: parsed, parse_rejected_invocation_count: rejected,
		annotated_output_count: annotated, reviewed_output_count: reviewed,
	};
	assertProof(counts.declared_trial_count === counts.step_reached_trial_count + counts.step_not_reached_trial_count, `${step} oracle trial equation failed`);
	assertProof(counts.invocation_attempt_count === counts.initial_attempt_count + counts.retry_attempt_count, `${step} oracle retry equation failed`);
	assertProof(counts.invocation_attempt_count === counts.transport_failed_attempt_count + counts.transport_succeeded_attempt_count, `${step} oracle transport equation failed`);
	assertProof(counts.initial_attempt_count === counts.step_reached_trial_count, `${step} oracle reach equation failed`);
	assertProof(counts.transport_succeeded_attempt_count === counts.parse_succeeded_invocation_count + counts.parse_rejected_invocation_count, `${step} oracle parse equation failed`);
	assertProof(counts.annotated_output_count === counts.parse_succeeded_invocation_count && counts.reviewed_output_count === counts.parse_succeeded_invocation_count, `${step} oracle human-evidence equation failed`);
	return counts;
}

function oracleWilson(numerator: number, denominator: number) {
	const proportion = numerator / denominator;
	const zSquared = ORACLE_Z95 * ORACLE_Z95;
	const scale = 1 + zSquared / denominator;
	const center = (proportion + zSquared / (2 * denominator)) / scale;
	const margin = ORACLE_Z95 * Math.sqrt((proportion * (1 - proportion) + zSquared / (4 * denominator)) / denominator) / scale;
	return { confidence: 0.95 as const, method: "wilson_score" as const, lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) };
}

function oracleRate(definition: typeof ORACLE_RATE_DEFINITIONS[number], context: ReturnType<typeof oracleContext>, numerator: number, denominator: number, roleNotApplicable = false) {
	const [metric, denominatorUnit] = definition;
	if (roleNotApplicable || denominator === 0) return {
		state: "not_applicable" as const, metric, unit: "ratio" as const, denominator_unit: denominatorUnit, scorecard_context: context,
		reason: roleNotApplicable ? "role_not_applicable" as const : "zero_denominator" as const,
		numerator: 0 as const, denominator: 0 as const, sample_count: 0 as const, interval: { state: "not_applicable" as const },
	};
	assertProof(numerator >= 0 && numerator <= denominator, `Oracle calculated invalid ${metric} numerator`);
	return {
		state: "measured" as const, metric, unit: "ratio" as const, denominator_unit: denominatorUnit, scorecard_context: context,
		numerator, denominator, sample_count: denominator, value: numerator / denominator, interval: oracleWilson(numerator, denominator),
	};
}

function oracleRates(input: LoadedEvaluationScorecardInput, step: ProductionModelStep, context: ReturnType<typeof oracleContext>) {
	const invocations = oracleRoleEvidence(input, step).flatMap(({ invocations: roleInvocations }) => roleInvocations);
	const providerSuccesses = invocations.filter(({ transport }) => transport === "succeeded");
	const annotations = input.annotations.outputs.filter(({ output }) => output.production_step === step);
	const claims = annotations.flatMap(({ factual_claims }) => factual_claims);
	const requiredClaims = claims.filter(({ attribution_requirement }) => attribution_requirement === "required");
	const events = annotations.flatMap(({ event_coverage }) => event_coverage);
	const announcements = annotations.flatMap(({ announcement_relevance }) => announcement_relevance.state === "assessed" ? announcement_relevance.announcements : []);
	const copyedit = step.endsWith("copyedit");
	const announcementRole = step.startsWith("announcements");
	const selected = input.selectedOutputs.filter(({ identity }) => identity.production_step === step);
	const preserved = copyedit ? selected.filter(({ trial }) => {
		const track = step.startsWith("main_story") ? "main_story" : "announcements";
		return !trial.tracks[track].findings.some(({ kind, production_step }) => kind === "preservation" && production_step === step);
	}).length : 0;
	return [
		oracleRate(ORACLE_RATE_DEFINITIONS[0], context, providerSuccesses.filter(({ parse }) => parse.state === "succeeded").length, providerSuccesses.length),
		oracleRate(ORACLE_RATE_DEFINITIONS[1], context, preserved, copyedit ? selected.length : 0, !copyedit),
		oracleRate(ORACLE_RATE_DEFINITIONS[2], context, claims.filter(({ grounding }) => grounding === "grounded").length, claims.length),
		oracleRate(ORACLE_RATE_DEFINITIONS[3], context, requiredClaims.filter(({ attribution }) => attribution === "present").length, requiredClaims.length),
		oracleRate(ORACLE_RATE_DEFINITIONS[4], context, events.filter(({ assessment }) => assessment === "covered").length, events.length),
		oracleRate(ORACLE_RATE_DEFINITIONS[5], context, announcements.filter(({ assessment }) => assessment === "relevant").length, announcementRole ? announcements.length : 0, !announcementRole),
	];
}

interface OracleSampleIdentity { run_id: string; trial_id: string; invocation_id: string }
interface OracleCandidate { identity: OracleSampleIdentity; value: number | undefined }

function oracleDistribution(metric: typeof ORACLE_DISTRIBUTIONS[number], context: ReturnType<typeof oracleContext>, candidates: readonly OracleCandidate[]) {
	const samples = candidates.flatMap(({ identity, value }) => value === undefined ? [] : [{ ...identity, value }]);
	const values = samples.map(({ value }) => value).sort((left, right) => left - right);
	const middle = Math.floor(values.length / 2);
	const summary = values.length === 0 ? { state: "unavailable" as const } : {
		state: "measured" as const, min: values[0]!,
		median: values.length % 2 === 0 ? (values[middle - 1]! + values[middle]!) / 2 : values[middle]!,
		mean: values.reduce((sum, value) => sum + value, 0) / values.length, max: values.at(-1)!,
	};
	return {
		metric, unit: metric.includes("tokens") ? "tokens" as const : "milliseconds" as const, scorecard_context: context,
		sample_count: candidates.length, observed_sample_count: samples.length, unavailable_sample_count: candidates.length - samples.length,
		samples, summary,
	};
}

function oracleDistributions(input: LoadedEvaluationScorecardInput, step: ProductionModelStep, context: ReturnType<typeof oracleContext>) {
	const tokenCandidates: Record<"input_tokens" | "output_tokens" | "total_tokens", OracleCandidate[]> = { input_tokens: [], output_tokens: [], total_tokens: [] };
	const application: OracleCandidate[] = []; const firstToken: OracleCandidate[] = []; const providerTotal: OracleCandidate[] = [];
	for (const { loaded, trial, invocations } of oracleRoleEvidence(input, step)) for (const invocation of invocations) {
		const identity = { run_id: loaded.run.id, trial_id: trial.id, invocation_id: invocation.id };
		application.push({ identity, value: invocation.transport === "in_flight" ? undefined : invocation.duration_ms });
		if (invocation.transport !== "succeeded") continue;
		for (const field of ["input_tokens", "output_tokens", "total_tokens"] as const) tokenCandidates[field].push({
			identity, value: invocation.completion.token_usage.measurement === "reported" ? invocation.completion.token_usage[field] : undefined,
		});
		const runtime = loaded.run.runtime_evidence.find(({ invocation_id }) => invocation_id === invocation.id);
		assertProof(runtime?.state === "captured", `Oracle distribution lacks runtime for ${invocation.id}`);
		const first = runtime.evidence.prediction_observation.time_to_first_token_ms;
		const total = runtime.evidence.prediction_observation.total_time_ms;
		firstToken.push({ identity, value: first.state === "observed" ? first.value : undefined });
		providerTotal.push({ identity, value: total.state === "observed" ? total.value : undefined });
	}
	return [
		oracleDistribution(ORACLE_DISTRIBUTIONS[0], context, tokenCandidates.input_tokens),
		oracleDistribution(ORACLE_DISTRIBUTIONS[1], context, tokenCandidates.output_tokens),
		oracleDistribution(ORACLE_DISTRIBUTIONS[2], context, tokenCandidates.total_tokens),
		oracleDistribution(ORACLE_DISTRIBUTIONS[3], context, application),
		oracleDistribution(ORACLE_DISTRIBUTIONS[4], context, firstToken),
		oracleDistribution(ORACLE_DISTRIBUTIONS[5], context, providerTotal),
	];
}

function oracleQualitative(input: LoadedEvaluationScorecardInput, step: ProductionModelStep, context: ReturnType<typeof oracleContext>) {
	const reviews = input.reviews.reviews.filter(({ output }) => output.production_step === step);
	return ORACLE_CRITERIA.map((criterion, criterionIndex) => {
		const evidence = reviews.map((review) => {
			const assessment = review.criteria[criterionIndex]!;
			return { review_id: review.review_id, output: review.output, assessment: assessment.assessment, rationale: assessment.rationale, uncertainty: assessment.uncertainty };
		});
		return {
			criterion, unit: "review_assessment" as const, sample_unit: "human_reviewed_output" as const, scorecard_context: context,
			sample_count: evidence.length,
			counts: {
				meets: evidence.filter(({ assessment }) => assessment === "meets").length,
				partly_meets: evidence.filter(({ assessment }) => assessment === "partly_meets").length,
				does_not_meet: evidence.filter(({ assessment }) => assessment === "does_not_meet").length,
				uncertain: evidence.filter(({ assessment }) => assessment === "uncertain").length,
			},
			evidence,
		};
	});
}

function proveIndependentCalculationOracle(input: LoadedEvaluationScorecardInput, artifact: EvaluationScorecardArtifact): void {
	assertProof(artifact.scorecards.length === PRODUCTION_MODEL_STEPS.length, "Oracle expected exactly four role scorecards");
	for (const [index, step] of PRODUCTION_MODEL_STEPS.entries()) {
		const actual = artifact.scorecards[index]!;
		assertProof(actual.production_step === step, `Oracle role order changed at ${step}`);
		const context = oracleContext(input, step);
		assertProof(isDeepStrictEqual(actual.scorecard_context, context), `${step} context projection or identity differs from raw-evidence oracle`);
		const selectedConfig = input.runs[0]!.run.declaration.configurations.find(({ identity }) => identity === input.declaration.configuration_identity)!.config.production_steps[step];
		assertProof(isDeepStrictEqual(actual.adapter, selectedConfig), `${step} adapter differs from raw-evidence oracle`);
		assertProof(isDeepStrictEqual(actual.sample_counts, oracleSampleCounts(input, step)), `${step} sample counts differ from raw-evidence oracle`);
		const rates = oracleRates(input, step, context);
		assertProof(actual.rates.length === rates.length && rates.every((expected, rateIndex) => isDeepStrictEqual(actual.rates[rateIndex], expected)), `${step} rate numerators, denominators, units, applicability, values, or Wilson endpoints differ from raw-evidence oracle`);
		const distributions = oracleDistributions(input, step, context);
		assertProof(actual.distributions.length === distributions.length && distributions.every((expected, distributionIndex) => isDeepStrictEqual(actual.distributions[distributionIndex], expected)), `${step} distribution candidates, samples, summaries, or unavailable counts differ from raw-evidence oracle`);
		const qualitative = oracleQualitative(input, step, context);
		assertProof(actual.qualitative.length === qualitative.length && qualitative.every((expected, criterionIndex) => isDeepStrictEqual(actual.qualitative[criterionIndex], expected)), `${step} qualitative counts or evidence differ from raw-evidence oracle`);
	}
	const requiredAttribution = artifact.scorecards.flatMap(({ rates }) => rates).filter(({ metric }) => metric === "required_attribution");
	assertProof(requiredAttribution.some((rate) => rate.state === "measured" && rate.denominator > 0 && rate.numerator > 0), "Controlled evidence did not measure truthful required attribution");
}

function proveSampleEquations(artifact: EvaluationScorecardArtifact): void {
	for (const scorecard of artifact.scorecards) {
		const counts = scorecard.sample_counts;
		const count = (key: keyof typeof counts): number => {
			const value = counts[key];
			assertProof(value !== undefined, `${scorecard.production_step} omitted ${key}`);
			return value;
		};
		assertProof(count("declared_trial_count") === count("step_reached_trial_count") + count("step_not_reached_trial_count"), `${scorecard.production_step} trial equation failed`);
		assertProof(count("invocation_attempt_count") === count("initial_attempt_count") + count("retry_attempt_count"), `${scorecard.production_step} retry equation failed`);
		assertProof(count("invocation_attempt_count") === count("transport_failed_attempt_count") + count("transport_succeeded_attempt_count"), `${scorecard.production_step} transport equation failed`);
		assertProof(count("initial_attempt_count") === count("step_reached_trial_count"), `${scorecard.production_step} initial-attempt equation failed`);
		assertProof(count("transport_succeeded_attempt_count") === count("parse_succeeded_invocation_count") + count("parse_rejected_invocation_count"), `${scorecard.production_step} parse equation failed`);
		assertProof(count("annotated_output_count") === count("parse_succeeded_invocation_count") && count("reviewed_output_count") === count("parse_succeeded_invocation_count"), `${scorecard.production_step} annotation/review equation failed`);
		const schemaRate = scorecard.rates.find(({ metric }) => metric === "schema_reliability")!;
		assertProof(schemaRate.denominator === count("transport_succeeded_attempt_count"), `${scorecard.production_step} counted transport failure as schema evidence`);
	}
	assertProof(artifact.scorecards.some(({ sample_counts }) => sample_counts.retry_attempt_count !== undefined && sample_counts.retry_attempt_count > 0), "Controlled scorecard lacks retry evidence");
	assertProof(artifact.scorecards.some(({ sample_counts }) => sample_counts.transport_failed_attempt_count !== undefined && sample_counts.transport_failed_attempt_count > 0), "Controlled scorecard lacks transport-failure evidence");
	assertProof(artifact.scorecards.some(({ sample_counts }) => sample_counts.parse_rejected_invocation_count !== undefined && sample_counts.parse_rejected_invocation_count > 0), "Controlled scorecard lacks parse-rejection evidence");
	assertProof(artifact.scorecards.some(({ sample_counts }) => sample_counts.step_not_reached_trial_count !== undefined && sample_counts.step_not_reached_trial_count > 0), "Controlled scorecard lacks dependency-not-reached evidence");
	const providerTiming = artifact.scorecards.flatMap(({ distributions }) => distributions).filter(({ metric }) => metric.startsWith("provider_"));
	assertProof(providerTiming.some(({ unavailable_sample_count }) => unavailable_sample_count > 0), "Controlled scorecard lacks explicit unavailable provider timing");
	const zeroDenominators = artifact.scorecards.flatMap(({ rates }) => rates).filter((rate) => rate.state === "not_applicable" && rate.reason === "zero_denominator");
	assertProof(zeroDenominators.length > 0 && zeroDenominators.every(({ numerator, denominator, sample_count, interval }) => numerator === 0 && denominator === 0 && sample_count === 0 && "state" in interval && interval.state === "not_applicable"), "Zero denominator was converted into a measured percentage");
}

async function invokeCli(argv: readonly string[], root: string, appDirectory: string): Promise<string> {
	let output = "";
	await runEvalCliApplication({ argv, currentDirectory: root, appDirectory, environment: { INIT_CWD: root }, writeOutput: (text) => { output += text; } });
	return output;
}

async function proveLegacyReaderAndCliInvariance(root: string, manifestPath: string): Promise<void> {
	const runtimeVerifierOutput: string[] = [];
	const originalLog = console.log;
	try {
		console.log = (...values: unknown[]) => { runtimeVerifierOutput.push(values.map(String).join(" ")); };
		await verifyBenchmarkRuntimeEvidence(join(root, "v1-v7-reader-proof"));
	} finally { console.log = originalLog; }
	assertProof(runtimeVerifierOutput.includes("BENCHMARK RUNTIME EVIDENCE VERIFIED"), "V1-V7 Benchmark Run reader verifier did not complete");
	await verifyEvaluationBenchmarkBrowsing(join(root, "benchmark-reader-cli-proof"));
	const corpusReport = await verifyEvaluationReferenceCorpus(manifestPath);
	assertProof(corpusReport.length > 0, "Reference corpus verifier returned no report");
	const acceptanceDirectory = join(root, "acceptance-run-file-proof");
	await verifyRecordedReplayAcceptance(acceptanceDirectory);
	const acceptanceRuns = await listRunFiles(acceptanceDirectory);
	assertProof(acceptanceRuns.length >= 2, "Acceptance Run File reader did not retain both deterministic runs");
	const firstAcceptanceId = acceptanceRuns[0]!.id;
	const secondAcceptanceId = acceptanceRuns[1]!.id;
	const acceptanceApp = join(root, "acceptance-cli-app");
	assertProof((await invokeCli(["acceptance", "list", "--results-dir", acceptanceDirectory], root, acceptanceApp)).includes(firstAcceptanceId), "Acceptance list CLI omitted a retained Run File");
	assertProof((await invokeCli(["acceptance", "show", firstAcceptanceId, "--results-dir", acceptanceDirectory], root, acceptanceApp)).includes(firstAcceptanceId), "Acceptance show CLI did not read a retained Run File");
	assertProof((await invokeCli(["acceptance", "compare", firstAcceptanceId, secondAcceptanceId, "--results-dir", acceptanceDirectory], root, acceptanceApp)).length > 0, "Acceptance compare CLI returned no report");
	assertProof((await invokeCli(["corpus", "show", "--corpus", manifestPath], root, join(root, "corpus-cli-app"))).length > 0, "Corpus show CLI returned no report");
	const validRoutes: ReadonlyArray<readonly [readonly string[], string]> = [
		[["benchmark", "run", "--fixture", "fixture.json", "--config", "config.json"], "benchmark-run"],
		[["benchmark", "list"], "benchmark-list"],
		[["benchmark", "show", "benchmark-one"], "benchmark-show"],
		[["benchmark", "summary", "benchmark-one"], "benchmark-summary"],
		[["benchmark", "compare", "benchmark-one", "benchmark-two"], "benchmark-compare"],
		[["acceptance", "run", "--fixture", "fixture.json"], "acceptance-run"],
		[["acceptance", "list"], "acceptance-list"],
		[["acceptance", "show", firstAcceptanceId], "acceptance-show"],
		[["acceptance", "compare", firstAcceptanceId, secondAcceptanceId], "acceptance-compare"],
		[["fixture", "record-responses", "--fixture", "fixture.json", "--config", "config.json"], "fixture-record-responses"],
		[["context", "benchmark", "--fixture", "fixture.json"], "context-benchmark"],
		[["corpus", "show", "--corpus", manifestPath], "corpus-show"],
	];
	for (const [argv, expected] of validRoutes) {
		assertProof(parseEvalCliCommand(argv).command === expected, `Existing valid CLI route changed: ${argv.join(" ")}`);
	}
}

export async function verifyEvaluationScorecards(temporaryRoot?: string, explicitManifestPath?: string): Promise<string> {
	const root = temporaryRoot ?? await mkdtemp(join(tmpdir(), "bc-news-evaluation-scorecards-"));
	const manifestPath = explicitManifestPath ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/fixtures/evaluation-corpus/manifest.json");
	try {
		const { declarationPath, createdAt } = await buildControlledEvaluationScorecardInput(root, manifestPath);
		const loaded = await loadEvaluationScorecardInput(declarationPath);
		await expectCode(() => {
			buildEvaluationScorecard(loaded, { id: "pre-review-scorecard", createdAt: "2000-01-01T00:00:00.000Z" });
		}, "chronology_mismatch");
		const artifact = buildEvaluationScorecard(loaded, { id: "controlled-evaluation-scorecard", createdAt });
		proveIndependentCalculationOracle(loaded, artifact);
		proveSampleEquations(artifact);
		await proveUnavailableTokenUsage(declarationPath, createdAt, root);
		const resultsDirectory = join(root, "scorecards");
		await mkdir(resultsDirectory, { recursive: true });
		await createEvaluationScorecardArtifact(join(resultsDirectory, `${artifact.id}.json`), artifact);
		const saved = await loadEvaluationScorecardArtifact(artifact.id, resultsDirectory);
		const report = formatEvaluationScorecardReport(saved);
		for (const step of PRODUCTION_MODEL_STEPS) assertProof(report.includes(`Scorecard role: ${step}`), `Scorecard report omitted ${step}`);
		assertProof((report.match(/Scorecard role:/gu) ?? []).length === 4, "Scorecard report did not render exactly four role sections");
		for (const evidence of ["wilson_score", "denominator_unit", "scorecard_context", "application_latency_ms", "provider_total_time_ms", "review_assessment", "rationale", "uncertainty"]) {
			assertProof(report.includes(evidence), `Scorecard report omitted ${evidence}`);
		}
		assertProof(report.includes("Qualitative reviewer: repository-human-reviewer (human)"), "Scorecard report omitted human reviewer identity");
		assertProof(report.includes("Qualitative rubric: bc-news-editorial-qualitative v1"), "Scorecard report omitted qualitative rubric identity");
		assertProof(report.includes("Annotation protocol: bc-news-output-annotation v1"), "Scorecard report omitted strict annotation protocol");
		assertProof(report.includes("Human annotator: repository-human-annotator (human)"), "Scorecard report omitted human annotator identity");
		assertProof((report.match(/Ordered annotation evidence:/gu) ?? []).length === 4, "Scorecard report did not render role-ordered annotation evidence");
		assertProof(report.includes(loaded.annotations.outputs[0]!.annotation_id), "Scorecard report omitted annotation identity");
		for (const annotationEvidence of [
			'"benchmark_run_id"', '"invocation_id"', '"spans"', '"references"', '"supports_status_qualified"',
			'"attribution_requirement": "required"', '"attribution": "present"', '"event_coverage"',
			'"announcement_relevance"', '"assessment"', '"rationale"', '"uncertainty"',
		]) assertProof(report.includes(annotationEvidence), `Scorecard report omitted annotation evidence ${annotationEvidence}`);
		for (const label of [
			"coherence: internally understandable organization and relationships",
			"usefulness: useful source-grounded information for a regional reader",
			"newsworthiness: human judgment that included material is worth reporting, without requiring one target angle",
			"voice: adherence to the declared in-world straightforward editorial voice",
		]) assertProof(report.includes(label), `Scorecard report omitted fixed rubric label ${label}`);
		const explicitCliDirectory = join(root, "cli-scorecards");
		const buildReport = await invokeCli(["scorecard", "build", "--input", declarationPath, "--results-dir", explicitCliDirectory], root, join(root, "app"));
		assertProof(buildReport.includes("Scorecard role: main_story_write"), "Scorecard build CLI omitted its report");
		const [createdName] = (await readdir(explicitCliDirectory)).filter((name) => name.endsWith(".json"));
		assertProof(createdName !== undefined, "Scorecard build CLI did not retain an artifact");
		const createdId = createdName.slice(0, -5);
		const showReport = await invokeCli(["scorecard", "show", createdId, "--results-dir", explicitCliDirectory], root, join(root, "app"));
		assertProof(showReport === buildReport, "Scorecard show CLI did not reproduce the build report");
		await invokeCli(["scorecard", "build", "--input", declarationPath], root, join(root, "default-app"));
		assertProof((await readdir(join(root, "default-app", "scorecard-results"))).some((name) => name.endsWith(".json")), "Scorecard CLI did not use its default result directory");
		await proveLegacyReaderAndCliInvariance(root, manifestPath);
		for (const argv of [["benchmark", "list"], ["acceptance", "list"], ["corpus", "show", "--corpus", manifestPath]] as const) {
			parseEvalCliCommand(argv);
			let isolated = false;
			try { parseEvalCliCommand([...argv, "--input", declarationPath]); } catch { isolated = true; }
			assertProof(isolated, `Existing route accepted --input: ${argv.join(" ")}`);
		}
		await expectCode(() => loadEvaluationScorecardArtifact("bad/id", resultsDirectory), "invalid_scorecard_id");
		await expectCode(() => loadEvaluationScorecardArtifact("missing-scorecard", resultsDirectory), "scorecard_not_found");
		const malformedDirectory = join(root, "malformed-scorecard");
		await mkdir(malformedDirectory);
		await writeFile(join(malformedDirectory, "malformed.json"), "{not-json\n", "utf8");
		await expectCode(() => loadEvaluationScorecardArtifact("malformed", malformedDirectory), "scorecard_malformed");
		const mismatchDirectory = join(root, "mismatch-scorecard");
		await mkdir(mismatchDirectory);
		await writeFile(join(mismatchDirectory, "different-id.json"), json(artifact), "utf8");
		await expectCode(() => loadEvaluationScorecardArtifact("different-id", mismatchDirectory), "scorecard_filename_mismatch");
		const tamperedDirectory = join(root, "tampered-scorecard");
		await mkdir(tamperedDirectory);
		await writeFile(join(tamperedDirectory, `${artifact.id}.json`), json({ ...artifact, repetition_count: artifact.repetition_count + 1 }), "utf8");
		await expectCode(() => loadEvaluationScorecardArtifact(artifact.id, tamperedDirectory), "artifact_tampered");
		await proveInputCorruptionCodes(declarationPath);
		await proveArtifactCorruptionCodes(artifact, root);
		return report;
	} finally {
		if (temporaryRoot === undefined) await rm(root, { recursive: true, force: true });
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	verifyEvaluationScorecards().then(() => console.log("EVALUATION SCORECARDS VERIFIED")).catch((error: unknown) => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}
