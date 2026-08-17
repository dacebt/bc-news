import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { promisify } from "node:util";
import { ACTIVE_REGION_IDS } from "@bc-news/contracts";
import { PRODUCTION_MODEL_STEPS, type ProductionModelStep } from "@bc-news/generation-core";
import { evaluateBenchmarkCommand } from "./evaluation-benchmark-command";
import {
	loadEvaluationReferenceCorpus,
	loadLocalEvaluationReferenceCorpus,
	type LoadedEvaluationReferenceCorpus,
} from "./evaluation-reference-corpus";
import { EvaluationReferenceManifestV3Schema } from "./evaluation-reference-corpus-local";
import { sourceReferenceForLocalFile } from "./evaluation-local-source-reference";
import { evaluationRepositoryHead } from "./evaluation-repository-reference";
import { startRecordLoopbackServer } from "./record-loopback-server";
import {
	assertProof,
	buildControlledArtifacts,
	controlledOutputs,
	json,
	type ControlledRun,
	type JsonObject,
	verifierConfiguration,
	gatewayRequestHashesForStep,
	gatewayRequestSha256,
	gatewayRequestSha256s,
} from "./evaluation-scorecard-verifier-support";

const execFileAsync = promisify(execFile);
const LOCAL_SELECTION_REGION_IDS = ACTIVE_REGION_IDS.slice(0, 12);

function repositoryPath(root: string, path: string): string { return relative(root, path).split(sep).join("/"); }
async function git(root: string, ...args: string[]): Promise<string> {
	const { stdout } = await execFileAsync("git", ["-C", root, ...args], { encoding: "utf8" });
	return stdout.trim();
}
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }

export { gatewayRequestHashesForStep, gatewayRequestSha256, gatewayRequestSha256s };

async function writeLocalCorpusJson(localDataRoot: string, relativePath: string, value: unknown): Promise<void> {
	const absolutePath = join(localDataRoot, relativePath);
	await mkdir(dirname(absolutePath), { recursive: true });
	await writeFile(absolutePath, json(value as object), "utf8");
}

function selectionWindowForFixture(fixture: { messages: ReadonlyArray<{ ts: number }> }, fixtureId: string): { start_utc: string; end_utc: string } {
	const timestamps = fixture.messages.map(({ ts }) => ts);
	const start = Math.min(...timestamps);
	const end = Math.max(...timestamps) + 1;
	assertProof(Number.isFinite(start) && Number.isFinite(end) && end > start, `Controlled fixture ${fixtureId} requires timestamped messages`);
	return { start_utc: new Date(start).toISOString(), end_utc: new Date(end).toISOString() };
}

async function buildControlledLocalCorpus(localDataRoot: string, sourceCorpus: LoadedEvaluationReferenceCorpus): Promise<{ manifestPath: string }> {
	const corpusPath = "corpus";
	const localEntries = await Promise.all(sourceCorpus.entries.map(async (entry, index) => {
		const activeRegionId = LOCAL_SELECTION_REGION_IDS[index];
		assertProof(activeRegionId !== undefined, `Missing active region id for local scorecard fixture ${entry.manifestEntry.id}`);
		const fixture = { ...entry.fixture, active_region_id: activeRegionId };
		const evidencePath = `${corpusPath}/evidence/${entry.manifestEntry.id}.json`;
		const referencePath = `${corpusPath}/references/${entry.manifestEntry.id}.json`;
		await writeLocalCorpusJson(localDataRoot, evidencePath, fixture);
		await writeLocalCorpusJson(localDataRoot, referencePath, entry.reference);
		return {
			ordinal: index + 1,
			id: entry.manifestEntry.id,
			fixture,
			preparedEvidence: { ...entry.preparedEvidence, active_region_id: activeRegionId },
			variation_tags: entry.manifestEntry.variation_tags,
			variation_witnesses: entry.manifestEntry.variation_witnesses,
			evidence: await sourceReferenceForLocalFile(localDataRoot, evidencePath),
			reference: await sourceReferenceForLocalFile(localDataRoot, referencePath),
		};
	}));
	const evidenceDate = localEntries[0]?.fixture.evidence_date;
	assertProof(typeof evidenceDate === "string", "Controlled local scorecard corpus requires at least one fixture");
	const selectionPath = `${corpusPath}/selection.json`;
	await writeLocalCorpusJson(localDataRoot, selectionPath, {
		version: 1,
		id: sourceCorpus.manifest.id,
		snapshot_sha256: hash("controlled-local-selection"),
		evidence_date: evidenceDate,
		cases: localEntries.map((entry) => ({ ordinal: entry.ordinal, id: entry.id, active_region_id: entry.fixture.active_region_id, windows: [selectionWindowForFixture(entry.fixture, entry.id)], expected_raw_count: entry.fixture.messages.length, expected_prepared_count: entry.preparedEvidence.final_count })),
	});
	const manifestPath = `${corpusPath}/manifest.json`;
	const manifest = {
		version: 3,
		id: sourceCorpus.manifest.id,
		selection: await sourceReferenceForLocalFile(localDataRoot, selectionPath),
		fixtures: localEntries.map(({ ordinal, id, evidence, reference, variation_tags, variation_witnesses }) => ({ ordinal, id, evidence, reference, variation_tags, variation_witnesses })),
	};
	EvaluationReferenceManifestV3Schema.parse(manifest);
	await writeLocalCorpusJson(localDataRoot, manifestPath, manifest);
	return { manifestPath };
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

async function buildControlledRuns(repositoryRoot: string, manifestPath: string, evidenceRoot: string, options: { codeCommit: string; gateway: boolean }): Promise<{ runs: ControlledRun[]; createdAt: string; annotations: JsonObject; reviews: JsonObject }> {
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
					const metadata = typeof init?.headers === "object" && init.headers !== null && !Array.isArray(init.headers) ? JSON.parse((init.headers as Record<string, string>)["cf-aig-metadata"] ?? "null") as { production_step?: unknown } | null : null;
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
	return { runs, ...buildControlledArtifacts(runs, corpus.manifest.id) };
}

async function buildControlledLocalRuns(localDataRoot: string, manifestPath: string, options: { codeCommit: string }): Promise<{ runs: ControlledRun[]; createdAt: string; annotations: JsonObject; reviews: JsonObject }> {
	const corpus = await loadLocalEvaluationReferenceCorpus(localDataRoot, manifestPath);
	const resultsDirectory = join(localDataRoot, "benchmark-runs"); const configPath = join(localDataRoot, "benchmark.config.json");
	await mkdir(resultsDirectory, { recursive: true });
	await writeFile(configPath, json(verifierConfiguration(true)), "utf8");
	const runs: ControlledRun[] = []; let gatewayOrdinal = 0;
	const originalFetch = globalThis.fetch;
	try {
		for (const entry of corpus.entries) {
			const retainedOutputs = controlledOutputs(entry);
			globalThis.fetch = (_input, init) => {
				const body = typeof init?.body === "string" ? JSON.parse(init.body) as { model?: unknown } : undefined;
				const metadata = typeof init?.headers === "object" && init.headers !== null && !Array.isArray(init.headers) ? JSON.parse((init.headers as Record<string, string>)["cf-aig-metadata"] ?? "null") as { production_step?: unknown } | null : null;
				const step = typeof metadata?.production_step === "string" ? metadata.production_step as ProductionModelStep : undefined;
				assertProof(typeof body?.model === "string", "Controlled Gateway request omitted its requested model");
				assertProof(step !== undefined && PRODUCTION_MODEL_STEPS.includes(step), "Controlled Gateway request omitted its production step");
				gatewayOrdinal += 1;
				return Promise.resolve(new Response(JSON.stringify({ id: `controlled-provider-response-${String(gatewayOrdinal)}`, object: "chat.completion", model: body.model, choices: [{ index: 0, message: { role: "assistant", content: retainedOutputs[step], refusal: null, annotations: [] }, finish_reason: "stop", logprobs: null }], usage: { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 }, gatewayMetadata: { keySource: "Unified" } }), { headers: { "content-type": "application/json", "cf-aig-log-id": `controlled-gateway-log-${String(gatewayOrdinal)}` } }));
			};
			const result = await evaluateBenchmarkCommand({ fixturePath: join(localDataRoot, entry.evidencePath), configPath, resultsDirectory, environment: { CLOUDFLARE_ACCOUNT_ID: "controlled-account", CLOUDFLARE_API_TOKEN: "controlled-token" }, sourceProvenance: { repository: "bc-news", commit_sha: options.codeCommit, dirty: false } });
			assertProof(result.benchmark.version === 8, "Controlled Gateway scorecard benchmark must be V8");
			runs.push({ run: result.benchmark, path: result.path, entry });
		}
	} finally { globalThis.fetch = originalFetch; }
	return { runs, ...buildControlledArtifacts(runs, corpus.manifest.id) };
}

export async function buildControlledEvaluationScorecardInputV2(repositoryRoot: string, manifestPath: string, options: { directory: string; codeCommit: string }): Promise<{ declarationPath: string; createdAt: string }> {
	const evidenceRoot = join(repositoryRoot, options.directory);
	const { runs, createdAt, annotations, reviews } = await buildControlledRuns(repositoryRoot, manifestPath, evidenceRoot, { codeCommit: options.codeCommit, gateway: false });
	const annotationPath = join(evidenceRoot, "annotations.json"); const reviewPath = join(evidenceRoot, "reviews.json");
	await Promise.all([writeFile(annotationPath, json(annotations), "utf8"), writeFile(reviewPath, json(reviews), "utf8")]);
	const declarationPath = join(evidenceRoot, "scorecard-input.json");
	await writeFile(declarationPath, json({ version: 2, id: "controlled-v2-input", corpus: { manifest_path: repositoryPath(repositoryRoot, manifestPath) }, configuration_identity: runs[0]!.run.declaration.configurations[0]!.identity, runs: runs.map(({ run, path, entry }, index) => ({ ordinal: index + 1, corpus_fixture_id: entry.manifestEntry.id, benchmark_run_id: run.id, path: repositoryPath(repositoryRoot, path) })), annotations: { path: repositoryPath(repositoryRoot, annotationPath), bundle_id: annotations.id as string }, qualitative_reviews: { path: repositoryPath(repositoryRoot, reviewPath), bundle_id: reviews.id as string } }), "utf8");
	await git(repositoryRoot, "add", repositoryPath(repositoryRoot, evidenceRoot));
	await git(repositoryRoot, "commit", "-m", "Add controlled scorecard v2 evidence");
	return { declarationPath, createdAt };
}

export async function buildControlledEvaluationScorecardInputV3(repositoryRoot: string, manifestPath: string, localDataRoot: string, options: { codeCommit: string }): Promise<{ declarationPath: string; createdAt: string }> {
	const sourceCorpus = await loadEvaluationReferenceCorpus(manifestPath, repositoryRoot);
	const { manifestPath: localManifestSourcePath } = await buildControlledLocalCorpus(localDataRoot, sourceCorpus);
	const { runs, createdAt, annotations, reviews } = await buildControlledLocalRuns(localDataRoot, localManifestSourcePath, { codeCommit: options.codeCommit });
	const annotationPath = join(localDataRoot, "annotations.json"); const reviewPath = join(localDataRoot, "reviews.json");
	await Promise.all([writeFile(annotationPath, json(annotations), "utf8"), writeFile(reviewPath, json(reviews), "utf8")]);
	const declarationPath = join(localDataRoot, "scorecard-input.json");
	const annotationSourcePath = repositoryPath(localDataRoot, annotationPath); const reviewSourcePath = repositoryPath(localDataRoot, reviewPath);
	await writeFile(declarationPath, json({ version: 3, id: "controlled-v3-input", corpus: { source_reference: await sourceReferenceForLocalFile(localDataRoot, localManifestSourcePath) }, configuration_identity: runs[0]!.run.declaration.configurations[0]!.identity, runs: await Promise.all(runs.map(async ({ run, path, entry }, index) => ({ ordinal: index + 1, corpus_fixture_id: entry.manifestEntry.id, benchmark_run_id: run.id, source_reference: await sourceReferenceForLocalFile(localDataRoot, repositoryPath(localDataRoot, path)) }))), annotations: { source_reference: await sourceReferenceForLocalFile(localDataRoot, annotationSourcePath), bundle_id: annotations.id as string }, qualitative_reviews: { source_reference: await sourceReferenceForLocalFile(localDataRoot, reviewSourcePath), bundle_id: reviews.id as string } }), "utf8");
	return { declarationPath, createdAt };
}
