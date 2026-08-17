import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, promisify } from "node:util";
import { PRODUCTION_MODEL_STEPS, type ProductionModelStep } from "@bc-news/generation-core";
import { evaluateBenchmarkCommand } from "./evaluation-benchmark-command";
import type { V7BenchmarkRun, V8BenchmarkRun } from "./evaluation-artifact";
import { canonical } from "./evaluation-artifact-schemas";
import { EvaluationReferenceManifestSchema, loadEvaluationReferenceCorpus, type LoadedEvaluationReferenceCorpusEntry } from "./evaluation-reference-corpus";
import { sourceReferenceForLocalFile } from "./evaluation-local-source-reference";
import { evaluationRepositoryHead } from "./evaluation-repository-reference";
import { buildEvaluationScorecard } from "./evaluation-scorecard-builder";
import { buildEvaluationScorecardV2 } from "./evaluation-scorecard-builder-v2";
import { loadEvaluationScorecardInput } from "./evaluation-scorecard-input";
import { loadEvaluationScorecardInput as loadEvaluationScorecardInputV2 } from "./evaluation-scorecard-input-v2";
import { formatEvaluationScorecardReport } from "./evaluation-scorecard-report";
import { createEvaluationScorecardArtifact, evaluationScorecardFreshness, loadEvaluationScorecardArtifact } from "./evaluation-scorecard-store";
import { startRecordLoopbackServer } from "./record-loopback-server";

type JsonObject = Record<string, unknown>;
type ControlledRun = { run: V7BenchmarkRun | V8BenchmarkRun; path: string; entry: LoadedEvaluationReferenceCorpusEntry };
const execFileAsync = promisify(execFile);

function json(value: object): string { return `${JSON.stringify(value, null, 2)}\n`; }
function repositoryPath(root: string, path: string): string { return relative(root, path).split(sep).join("/"); }
function assertProof(condition: boolean, message: string): asserts condition { if (!condition) throw new Error(message); }
async function git(root: string, ...args: string[]): Promise<string> {
	const { stdout } = await execFileAsync("git", ["-C", root, ...args], { encoding: "utf8" });
	return stdout.trim();
}
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function gatewayRequestSha256(gatewayRequest: V8BenchmarkRun["gateway_requests"][number]): string {
	return hash(JSON.stringify(canonical(gatewayRequest)));
}
function gatewayRequestSha256s(run: V8BenchmarkRun): string[] {
	return run.gateway_requests.map((gatewayRequest) => gatewayRequestSha256(gatewayRequest));
}
function gatewayRequestHashesForStep(run: V8BenchmarkRun, step: ProductionModelStep): Array<{ run_id: string; trial_id: string; invocation_id: string; gateway_request_sha256: string }> {
	return run.trials.flatMap((trial) => trial.invocations
		.filter((invocation) => invocation.production_step === step)
		.map((invocation) => {
			const gatewayRequest = run.gateway_requests.find(({ invocation_id }) => invocation_id === invocation.id);
			assertProof(gatewayRequest !== undefined, `Controlled invocation ${invocation.id} lacks Gateway-request evidence`);
			return { run_id: run.id, trial_id: trial.id, invocation_id: invocation.id, gateway_request_sha256: gatewayRequestSha256(gatewayRequest) };
		}));
}

function verifierConfiguration(gateway: boolean): JsonObject {
	return {
		configurations: [{ production_steps: Object.fromEntries(PRODUCTION_MODEL_STEPS.map((step) => [step, {
			...(gateway ? {
				adapter: "cloudflare_ai_gateway",
				gateway: { selection: "named", id: "controlled-scorecard" },
				model: "openai/gpt-4o-mini",
			} : {
				adapter: "openai_compatible_hosted",
				provider: "repository_loopback",
				model: `scorecard/${step}`,
				billing: { method: "calculated", input_usd_per_million_tokens: 0, output_usd_per_million_tokens: 0, pricing_reference: "repository scorecard proof" },
			}),
		}])) }],
		repetition_count: 1,
		transport_retry_limit: 0,
	};
}

function claimTemplate(entry: LoadedEvaluationReferenceCorpusEntry): { proposition: string; referenceId: string; relation: "supports" | "supports_status_qualified" | "unresolved"; grounding: "grounded" | "indeterminate"; body: string } {
	const statusRecord = entry.reference.claims[0] ?? entry.reference.events[0];
	if (statusRecord !== undefined) {
		const kind = entry.reference.claims[0] === statusRecord ? "claim" : "event";
		if (statusRecord.status === "established") return { proposition: statusRecord.supporting_witnesses[0]!.excerpt, referenceId: `${kind}:${statusRecord.id}`, relation: "supports", grounding: "grounded", body: `Source record states: ${statusRecord.supporting_witnesses[0]!.excerpt}` };
		if (statusRecord.status === "contested") return { proposition: `${statusRecord.supporting_witnesses[0]!.excerpt} ${statusRecord.opposing_witnesses[0]!.excerpt}`, referenceId: `${kind}:${statusRecord.id}`, relation: "supports_status_qualified", grounding: "grounded", body: `Source accounts are contested: ${statusRecord.supporting_witnesses[0]!.excerpt} ${statusRecord.opposing_witnesses[0]!.excerpt}` };
		return { proposition: statusRecord.unresolved_witnesses[0]!.excerpt, referenceId: `${kind}:${statusRecord.id}`, relation: "unresolved", grounding: "indeterminate", body: `Source accounts leave this unresolved: ${statusRecord.unresolved_witnesses[0]!.excerpt}` };
	}
	const ambiguity = entry.reference.ambiguities[0];
	if (ambiguity !== undefined) return { proposition: ambiguity.witnesses[0]!.excerpt, referenceId: `ambiguity:${ambiguity.id}`, relation: "unresolved", grounding: "indeterminate", body: `Source accounts leave this unresolved: ${ambiguity.witnesses[0]!.excerpt}` };
	const noteworthy = entry.reference.noteworthy_candidates[0]!;
	return { proposition: noteworthy.witnesses[0]!.excerpt, referenceId: `noteworthy:${noteworthy.id}`, relation: "supports", grounding: "grounded", body: `Source record notes: ${noteworthy.witnesses[0]!.excerpt}` };
}

function controlledOutputs(entry: LoadedEvaluationReferenceCorpusEntry): Record<ProductionModelStep, string> {
	const sourceClaim = claimTemplate(entry);
	const story = { title: "Regional Notes", subtitle: "Source record", main_story: { headline: "Source record", lede: "Codex-reviewed source evidence.", body: sourceClaim.body } };
	const noteworthy = entry.reference.noteworthy_candidates[0];
	const announcements = noteworthy === undefined ? [] : [{ title: "Regional notice", summary: noteworthy.witnesses[0]!.excerpt }];
	return {
		main_story_write: JSON.stringify(story),
		main_story_copyedit: JSON.stringify(story),
		announcements_write: JSON.stringify({ announcements }),
		announcements_copyedit: JSON.stringify({ announcements: announcements.map((announcement, index) => ({ id: `announcement-${String(index + 1)}`, ...announcement })) }),
	};
}

function outputIdentity(run: V7BenchmarkRun | V8BenchmarkRun, entry: LoadedEvaluationReferenceCorpusEntry, invocation: V7BenchmarkRun["trials"][number]["invocations"][number], manifestId: string): JsonObject {
	assertProof(invocation.transport === "succeeded" && invocation.parse.state === "succeeded", "Controlled invocation did not parse successfully");
	assertProof(invocation.completion.text !== null, "Controlled parsed invocation has no textual completion");
	const runtime = run.runtime_evidence.find(({ invocation_id }) => invocation_id === invocation.id);
	assertProof(runtime?.state === "captured", `Controlled invocation ${invocation.id} lacks runtime evidence`);
	const trial = run.trials.find(({ id }) => id === runtime.trial_id)!;
	const identity = {
		benchmark_run_id: run.id, benchmark_run_version: run.version, code_commit_sha: run.provenance.code.commit_sha,
		prepared_evidence_identity_sha256: run.prepared_evidence.identity_sha256, corpus_manifest_id: manifestId,
		corpus_fixture_id: entry.manifestEntry.id, config_identity: invocation.config_identity,
		trial_id: trial.id, repetition: trial.repetition, invocation_id: invocation.id,
		production_step: invocation.production_step, invocation_ordinal: invocation.ordinal,
		request_sha256: invocation.request_sha256, completion_text_sha256: hash(invocation.completion.text),
		parsed_output_sha256: hash(JSON.stringify(canonical(invocation.parse.output))),
		runtime_evidence_sha256: hash(JSON.stringify(canonical(runtime.evidence))),
	};
	if (run.version === 7) return identity;
	const gatewayRequest = run.gateway_requests.find(({ invocation_id }) => invocation_id === invocation.id);
	assertProof(gatewayRequest !== undefined, `Controlled invocation ${invocation.id} lacks Gateway-request evidence`);
	return { ...identity, gateway_request_sha256: gatewayRequestSha256(gatewayRequest) };
}

function span(pointer: string, excerpt: string): JsonObject { return { json_pointer: pointer, start_utf16: 0, end_utf16: excerpt.length, excerpt }; }
function annotation(entry: LoadedEvaluationReferenceCorpusEntry, output: JsonObject, step: ProductionModelStep, ordinal: number): JsonObject {
	const sourceClaim = claimTemplate(entry); const storyRole = step.startsWith("main_story"); const noteworthy = entry.reference.noteworthy_candidates[0];
	const excerpt = storyRole ? sourceClaim.body : noteworthy?.witnesses[0]?.excerpt;
	const claim = excerpt === undefined ? [] : [{ id: `observed-claim-${String(ordinal)}`, proposition: storyRole ? sourceClaim.proposition : excerpt, atomic_proposition: true, spans: [span(storyRole ? "/main_story/body" : "/announcements/0/summary", excerpt)], references: [{ reference_id: storyRole ? sourceClaim.referenceId : `noteworthy:${noteworthy!.id}`, relation: storyRole ? sourceClaim.relation : "supports" }], grounding: storyRole ? sourceClaim.grounding : "grounded", attribution_requirement: storyRole ? "required" : "not_required", attribution: storyRole ? "present" : "not_applicable", rationale: "Codex bound the exact output span to the cited fixture reference.", uncertainty: "low" }];
	return {
		annotation_id: `annotation-${entry.manifestEntry.id}-${step}`, output, factual_claim_inventory_complete: true, factual_claims: claim,
		event_coverage: entry.reference.events.map((event) => storyRole && sourceClaim.referenceId === `event:${event.id}` ? { event_id: event.id, assessment: "covered", spans: [span("/main_story/body", sourceClaim.body)], rationale: "The exact story span communicates this source event.", uncertainty: "low" } : { event_id: event.id, assessment: "not_covered", spans: [], rationale: "This controlled output does not cover the source event.", uncertainty: "low" }),
		announcement_relevance: storyRole ? { state: "not_applicable" } : noteworthy === undefined ? { state: "assessed", announcements: [] } : { state: "assessed", announcements: [{ announcement_index: 0, assessment: "relevant", noteworthy_reference_ids: [`noteworthy:${noteworthy.id}`], rationale: "The exact summary communicates the cited candidate.", uncertainty: "low" }] },
	};
}
function review(entry: LoadedEvaluationReferenceCorpusEntry, output: JsonObject): JsonObject {
	return { review_id: `review-${entry.manifestEntry.id}-${output.production_step as string}`, output, criteria: ["coherence", "usefulness", "newsworthiness", "voice"].map((criterion) => ({ criterion, assessment: "meets", rationale: `Codex assessed ${criterion} against rubric version 2.`, uncertainty: "low" })) };
}

export async function initializeControlledEvaluationRepository(root: string, corpusSource: string): Promise<{ manifestPath: string; codeCommit: string }> {
	await mkdir(root, { recursive: true });
	await git(root, "init", "-b", "main");
	await git(root, "config", "user.email", "scorecard-verifier@example.invalid");
	await git(root, "config", "user.name", "Scorecard Verifier");
	const corpusDestination = join(root, "packages/fixtures/evaluation-corpus");
	await mkdir(dirname(corpusDestination), { recursive: true });
	await cp(corpusSource, corpusDestination, { recursive: true });
	await git(root, "add", "packages/fixtures/evaluation-corpus");
	await git(root, "commit", "-m", "Add controlled evaluation corpus");
	return { manifestPath: join(corpusDestination, "manifest.json"), codeCommit: await evaluationRepositoryHead(root) };
}

async function buildControlledRuns(repositoryRoot: string, manifestPath: string, evidenceRoot: string, options: { codeCommit: string; gateway: boolean; outputCorpusManifestId?: string }): Promise<{ corpus: Awaited<ReturnType<typeof loadEvaluationReferenceCorpus>>; runs: ControlledRun[]; createdAt: string; annotations: JsonObject; reviews: JsonObject }> {
	const corpus = await loadEvaluationReferenceCorpus(manifestPath, repositoryRoot);
	const resultsDirectory = join(evidenceRoot, "benchmark-runs"); const configPath = join(evidenceRoot, "benchmark.config.json");
	await mkdir(resultsDirectory, { recursive: true });
	await writeFile(configPath, json(verifierConfiguration(options.gateway)), "utf8");
	const runs: ControlledRun[] = []; let gatewayOrdinal = 0;
	const originalFetch = globalThis.fetch;
	try {
		for (const entry of corpus.entries) {
			const retainedOutputs = controlledOutputs(entry);
			if (options.gateway) {
				globalThis.fetch = (_input, init) => {
					const body = typeof init?.body === "string" ? JSON.parse(init.body) as { model?: unknown } : undefined;
					const metadata = typeof init?.headers === "object" && init.headers !== null && !Array.isArray(init.headers)
						? JSON.parse((init.headers as Record<string, string>)["cf-aig-metadata"] ?? "null") as { production_step?: unknown } | null
						: null;
					const step = typeof metadata?.production_step === "string" ? metadata.production_step as ProductionModelStep : undefined;
					assertProof(typeof body?.model === "string", "Controlled Gateway request omitted its requested model");
					assertProof(step !== undefined && PRODUCTION_MODEL_STEPS.includes(step), "Controlled Gateway request omitted its production step");
					gatewayOrdinal += 1;
					return Promise.resolve(new Response(JSON.stringify({ id: `controlled-provider-response-${String(gatewayOrdinal)}`, object: "chat.completion", model: body.model, choices: [{ index: 0, message: { role: "assistant", content: retainedOutputs[step], refusal: null, annotations: [] }, finish_reason: "stop", logprobs: null }], usage: { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 }, gatewayMetadata: { keySource: "Unified" } }), { headers: { "content-type": "application/json", "cf-aig-log-id": `controlled-gateway-log-${String(gatewayOrdinal)}` } }));
				};
				const result = await evaluateBenchmarkCommand({ fixturePath: join(repositoryRoot, entry.evidencePath), configPath, resultsDirectory, environment: { CLOUDFLARE_ACCOUNT_ID: "controlled-account", CLOUDFLARE_API_TOKEN: "controlled-token" }, sourceProvenance: { repository: "bc-news", commit_sha: options.codeCommit, dirty: false } });
				assertProof(result.benchmark.version === 8, "Controlled Gateway scorecard benchmark must be V8");
				runs.push({ run: result.benchmark, path: result.path, entry });
				continue;
			}
			const server = await startRecordLoopbackServer(Object.fromEntries(PRODUCTION_MODEL_STEPS.map((step) => [`scorecard/${step}`, retainedOutputs[step]])));
			try {
				const result = await evaluateBenchmarkCommand({ fixturePath: join(repositoryRoot, entry.evidencePath), configPath, resultsDirectory, environment: { HOSTED_MODEL_BASE_URL: server.baseUrl, HOSTED_MODEL_API_KEY: "record-loopback-proof" }, sourceProvenance: { repository: "bc-news", commit_sha: options.codeCommit, dirty: false } });
				assertProof(result.benchmark.version === 7, "Controlled scorecard benchmark must remain V7");
				runs.push({ run: result.benchmark, path: result.path, entry });
			} finally { await server.close(); }
		}
	} finally { globalThis.fetch = originalFetch; }
	const latestCompletion = Math.max(...runs.map(({ run }) => Date.parse(run.completed_at!)));
	const annotatedAt = new Date(latestCompletion + 1).toISOString(); const reviewedAt = new Date(latestCompletion + 2).toISOString(); const createdAt = new Date(latestCompletion + 3).toISOString();
	const outputCorpusManifestId = options.outputCorpusManifestId ?? corpus.manifest.id;
	const outputs = runs.flatMap(({ run, entry }) => run.trials.flatMap(({ invocations }) => invocations.filter((invocation) => invocation.transport === "succeeded" && invocation.parse.state === "succeeded").map((invocation) => ({ entry, step: invocation.production_step, identity: outputIdentity(run, entry, invocation, outputCorpusManifestId) }))));
	const annotations = { version: 2, id: "annotations-controlled", protocol: { id: "bc-news-output-annotation", version: 2 }, annotator: { id: "codex", kind: "codex" }, annotated_at: annotatedAt, outputs: outputs.map(({ entry, identity, step }, index) => annotation(entry, identity, step, index + 1)) };
	const reviews = { version: 2, id: "reviews-controlled", rubric: { id: "bc-news-editorial-qualitative", version: 2 }, reviewer: { id: "codex", kind: "codex" }, reviewed_at: reviewedAt, reviews: outputs.map(({ entry, identity }) => review(entry, identity)) };
	return { corpus, runs, createdAt, annotations, reviews };
}

async function buildControlledEvaluationScorecardInputV2(repositoryRoot: string, manifestPath: string, options: { directory: string; codeCommit: string }): Promise<{ declarationPath: string; createdAt: string }> {
	const evidenceRoot = join(repositoryRoot, options.directory);
	const { runs, createdAt, annotations, reviews } = await buildControlledRuns(repositoryRoot, manifestPath, evidenceRoot, { codeCommit: options.codeCommit, gateway: false });
	const annotationPath = join(evidenceRoot, "annotations.json"); const reviewPath = join(evidenceRoot, "reviews.json");
	await Promise.all([writeFile(annotationPath, json(annotations), "utf8"), writeFile(reviewPath, json(reviews), "utf8")]);
	const declarationPath = join(evidenceRoot, "scorecard-input.json");
	const declaration = {
		version: 2,
		id: "controlled-v2-input",
		corpus: { manifest_path: repositoryPath(repositoryRoot, manifestPath) },
		configuration_identity: runs[0]!.run.declaration.configurations[0]!.identity,
		runs: runs.map(({ run, path, entry }, index) => ({ ordinal: index + 1, corpus_fixture_id: entry.manifestEntry.id, benchmark_run_id: run.id, path: repositoryPath(repositoryRoot, path) })),
		annotations: { path: repositoryPath(repositoryRoot, annotationPath), bundle_id: annotations.id as string },
		qualitative_reviews: { path: repositoryPath(repositoryRoot, reviewPath), bundle_id: reviews.id as string },
	};
	await writeFile(declarationPath, json(declaration), "utf8");
	await git(repositoryRoot, "add", repositoryPath(repositoryRoot, evidenceRoot));
	await git(repositoryRoot, "commit", "-m", "Add controlled scorecard v2 evidence");
	return { declarationPath, createdAt };
}

async function buildControlledEvaluationScorecardInputV3(repositoryRoot: string, manifestPath: string, localDataRoot: string, options: { codeCommit: string }): Promise<{ declarationPath: string; createdAt: string }> {
	const corpusRoot = join(localDataRoot, "corpus");
	await cp(dirname(manifestPath), corpusRoot, { recursive: true });
	const localManifestPath = join(corpusRoot, "manifest.json");
	const sourceManifest = EvaluationReferenceManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")) as unknown);
	const localManifestId = `${sourceManifest.id}-local`;
	const localCorpusRoot = repositoryPath(localDataRoot, corpusRoot);
	const localFixtures = sourceManifest.fixtures.map((entry) => ({
		ordinal: entry.ordinal,
		id: entry.id,
		evidence_path: `${localCorpusRoot}/evidence/${entry.id}.json`,
		reference_path: `${localCorpusRoot}/references/${entry.id}.json`,
		variation_tags: entry.variation_tags,
		variation_witnesses: entry.variation_witnesses,
	}));
	await writeFile(localManifestPath, json({ version: 2, id: localManifestId, fixtures: localFixtures }), "utf8");
	const { runs, createdAt, annotations, reviews } = await buildControlledRuns(repositoryRoot, manifestPath, localDataRoot, { codeCommit: options.codeCommit, gateway: true, outputCorpusManifestId: localManifestId });
	const annotationPath = join(localDataRoot, "annotations.json"); const reviewPath = join(localDataRoot, "reviews.json");
	await Promise.all([writeFile(annotationPath, json(annotations), "utf8"), writeFile(reviewPath, json(reviews), "utf8")]);
	const declarationPath = join(localDataRoot, "scorecard-input.json");
	const localManifestSourcePath = repositoryPath(localDataRoot, localManifestPath);
	const annotationSourcePath = repositoryPath(localDataRoot, annotationPath);
	const reviewSourcePath = repositoryPath(localDataRoot, reviewPath);
	const declaration = {
		version: 3,
		id: "controlled-v3-input",
		corpus: { source_reference: await sourceReferenceForLocalFile(localDataRoot, localManifestSourcePath) },
		configuration_identity: runs[0]!.run.declaration.configurations[0]!.identity,
		runs: await Promise.all(runs.map(async ({ run, path, entry }, index) => ({ ordinal: index + 1, corpus_fixture_id: entry.manifestEntry.id, benchmark_run_id: run.id, source_reference: await sourceReferenceForLocalFile(localDataRoot, repositoryPath(localDataRoot, path)) }))),
		annotations: { source_reference: await sourceReferenceForLocalFile(localDataRoot, annotationSourcePath), bundle_id: annotations.id as string },
		qualitative_reviews: { source_reference: await sourceReferenceForLocalFile(localDataRoot, reviewSourcePath), bundle_id: reviews.id as string },
	};
	await writeFile(declarationPath, json(declaration), "utf8");
	return { declarationPath, createdAt };
}

export async function verifyEvaluationScorecards(temporaryRoot?: string): Promise<string> {
	const root = temporaryRoot ?? await mkdtemp(join(tmpdir(), "bc-news-evaluation-scorecards-")); const cleanup = temporaryRoot === undefined;
	try {
		const repositoryRoot = join(root, "repository");
		const corpusSource = resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/fixtures/evaluation-corpus");
		const { manifestPath, codeCommit } = await initializeControlledEvaluationRepository(repositoryRoot, corpusSource);
		const localDataRoot = join(repositoryRoot, "apps/eval/local-data");
		const beforeCount = await git(repositoryRoot, "rev-list", "--count", "HEAD");
		const controlled = await buildControlledEvaluationScorecardInputV3(repositoryRoot, manifestPath, localDataRoot, { codeCommit });
		const controlledDeclarationSourcePath = repositoryPath(localDataRoot, controlled.declarationPath);
		const afterCount = await git(repositoryRoot, "rev-list", "--count", "HEAD");
		assertProof(beforeCount === afterCount, "Local V3 build changed the repository commit count");
		const input = await loadEvaluationScorecardInput(controlledDeclarationSourcePath, localDataRoot);
		const artifact = buildEvaluationScorecard(input, { id: "controlled-evaluation-scorecard-v3", createdAt: controlled.createdAt });
		const serialized = json(artifact);
		for (const forbidden of ["source_payloads", "base64", "declaration_sha256", "benchmark_run_sha256", "reference_sha256"]) assertProof(!serialized.includes(forbidden), `Current scorecard retained forbidden byte ownership field ${forbidden}`);
		assertProof(artifact.version === 3 && artifact.sources.annotations.annotator_kind === "codex" && artifact.scorecards.length === 4, "Current V3 scorecard contract or Codex provenance is missing");
		const v8Runs = input.runs.map(({ run }) => {
			assertProof(run.version === 8, `Controlled scorecard source ${run.id} is not a V8 Benchmark Run`);
			return run;
		});
		assertProof(input.selectedOutputs.every(({ invocation, identity }) => {
			const run = v8Runs.find((candidate) => candidate.id === identity.benchmark_run_id);
			if (run === undefined || !("gateway_request_sha256" in identity)) return false;
			const gatewayRequest = run.gateway_requests.find(({ invocation_id }) => invocation_id === invocation.id);
			return gatewayRequest !== undefined && identity.gateway_request_sha256 === gatewayRequestSha256(gatewayRequest);
		}), "Gateway scorecard outputs omitted exact V8 request provenance");
		assertProof(artifact.sources.benchmark_runs.length === v8Runs.length && artifact.sources.benchmark_runs.every((source, index) => {
			const run = v8Runs[index];
			return run !== undefined
				&& source.benchmark_run_id === run.id
				&& "benchmark_run_version" in source
				&& source.benchmark_run_version === 8
				&& isDeepStrictEqual(source.gateway_request_sha256s, gatewayRequestSha256s(run));
		}), "Gateway scorecard sources omitted exact V8 request provenance");
		assertProof(artifact.scorecards.every(({ production_step, scorecard_context }) => {
			if (scorecard_context.state !== "identified") return true;
			return isDeepStrictEqual(scorecard_context.projection.gateway_request_hashes, v8Runs.flatMap((run) => gatewayRequestHashesForStep(run, production_step)));
		}), "Gateway scorecard contexts omitted ordered V8 request hashes");
		assertProof(artifact.scorecards.every(({ scorecard_context }) => scorecard_context.state === "identified" && JSON.stringify(scorecard_context.projection.corpus_source_reference) === JSON.stringify(input.corpus.sourceReference)), "Scorecard semantic context omitted the local corpus source reference");
		const results = join(root, "results"); await mkdir(results);
		await createEvaluationScorecardArtifact(join(results, `${artifact.id}.json`), artifact, { localDataRoot });
		const loaded = await loadEvaluationScorecardArtifact(artifact.id, results, { localDataRoot });
		assertProof(JSON.stringify(loaded) === JSON.stringify(artifact), "Stored V3 scorecard changed after local reconstruction");
		const runPath = ((JSON.parse(await readFile(controlled.declarationPath, "utf8")) as { runs: Array<{ source_reference: { path: string } }> }).runs[0]!.source_reference.path);
		await writeFile(join(localDataRoot, runPath), "{\n", "utf8");
		let tamperRejected = false; try { await loadEvaluationScorecardInput(controlledDeclarationSourcePath, localDataRoot); } catch { tamperRejected = true; }
		assertProof(tamperRejected, "Tampered local benchmark evidence was accepted");
		const restored = await buildControlledEvaluationScorecardInputV3(repositoryRoot, manifestPath, localDataRoot, { codeCommit });
		const restoredDeclarationSourcePath = repositoryPath(localDataRoot, restored.declarationPath);
		const restoredArtifact = buildEvaluationScorecard(await loadEvaluationScorecardInput(restoredDeclarationSourcePath, localDataRoot), { id: artifact.id, createdAt: restored.createdAt });
		await writeFile(join(results, `${artifact.id}.json`), json(restoredArtifact), "utf8");
		const mutatedArtifact = JSON.parse(await readFile(join(results, `${artifact.id}.json`), "utf8")) as JsonObject;
		((mutatedArtifact.scorecards as JsonObject[])[0]!.sample_counts as JsonObject).declared_trial_count = 999;
		await writeFile(join(results, `${artifact.id}.json`), json(mutatedArtifact), "utf8");
		let derivedRejected = false; try { await loadEvaluationScorecardArtifact(artifact.id, results, { localDataRoot }); } catch { derivedRejected = true; }
		assertProof(derivedRejected, "Derived V3 scorecard tampering was accepted");
		await writeFile(join(results, `${artifact.id}.json`), json(restoredArtifact), "utf8");
		const movedRoot = join(root, "relocated-local-data");
		await cp(localDataRoot, movedRoot, { recursive: true });
		assertProof((await loadEvaluationScorecardArtifact(artifact.id, results, { localDataRoot: movedRoot })).id === artifact.id, "Relocated local-data root did not reopen the scorecard");
		const declarationJson = JSON.parse(await readFile(restored.declarationPath, "utf8")) as { runs: Array<{ source_reference: { path: string; sha256: string } }> };
		declarationJson.runs[0]!.source_reference.path = "../escape.json";
		await writeFile(restored.declarationPath, json(declarationJson), "utf8");
		let traversalRejected = false; try { await loadEvaluationScorecardInput(restoredDeclarationSourcePath, localDataRoot); } catch { traversalRejected = true; }
		assertProof(traversalRejected, "Traversal source reference was accepted");
		declarationJson.runs[0]!.source_reference.path = "missing/benchmark.json";
		await writeFile(restored.declarationPath, json(declarationJson), "utf8");
		let missingRejected = false; try { await loadEvaluationScorecardInput(restoredDeclarationSourcePath, localDataRoot); } catch { missingRejected = true; }
		assertProof(missingRejected, "Missing local source reference was accepted");
		const symlinkTarget = join(root, "escaped-benchmark.json");
		await writeFile(symlinkTarget, "{}\n", "utf8");
		const symlinkPath = join(localDataRoot, "symlinked-benchmark.json");
		await symlink(symlinkTarget, symlinkPath);
		declarationJson.runs[0]!.source_reference.path = "symlinked-benchmark.json";
		await writeFile(restored.declarationPath, json(declarationJson), "utf8");
		let symlinkRejected = false; try { await loadEvaluationScorecardInput(restoredDeclarationSourcePath, localDataRoot); } catch { symlinkRejected = true; }
		assertProof(symlinkRejected, "Symlinked local source reference was accepted");
		await writeFile(join(repositoryRoot, "unrelated.txt"), "advance checkout\n", "utf8"); await git(repositoryRoot, "add", "unrelated.txt"); await git(repositoryRoot, "commit", "-m", "Advance checkout independently");
		const freshness = await evaluationScorecardFreshness(restoredArtifact, repositoryRoot);
		assertProof(freshness.state === "outdated", "Advanced checkout did not report V3 scorecard freshness as outdated");
		const report = formatEvaluationScorecardReport(restoredArtifact, freshness);
		assertProof(report.includes("sha256=") && report.includes("freshness=outdated"), "V3 scorecard report did not distinguish local source SHA from evaluated-code freshness");
		const legacy = await buildControlledEvaluationScorecardInputV2(repositoryRoot, manifestPath, { directory: "apps/eval/legacy-scorecard-evidence", codeCommit: await evaluationRepositoryHead(repositoryRoot) });
		const legacyInput = await loadEvaluationScorecardInputV2(legacy.declarationPath, repositoryRoot);
		const legacyArtifact = buildEvaluationScorecardV2(legacyInput, { id: "controlled-evaluation-scorecard-v2", createdAt: legacy.createdAt });
		await createEvaluationScorecardArtifact(join(results, `${legacyArtifact.id}.json`), legacyArtifact, { repositoryRoot });
		const reopenedLegacy = await loadEvaluationScorecardArtifact(legacyArtifact.id, results, { repositoryRoot });
		assertProof(reopenedLegacy.version === 2 && reopenedLegacy.id === legacyArtifact.id, "Historical V2 scorecard did not reopen through explicit version dispatch");
		return `${report}\nEVALUATION SCORECARDS VERIFIED`;
	} finally { if (cleanup) await rm(root, { recursive: true, force: true }); }
}

async function main(): Promise<void> { process.stdout.write(`${await verifyEvaluationScorecards()}\n`); }
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
