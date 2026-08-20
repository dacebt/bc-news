import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
	PRODUCTION_MODEL_STEPS,
	type ProductionModelStep,
} from "@bc-news/generation-core";
import { evaluateBenchmarkCommand } from "./evaluation-benchmark-command";
import {
	loadEvaluationReferenceCorpus,
	loadLocalEvaluationReferenceCorpus,
	type LoadedEvaluationReferenceCorpus,
} from "./evaluation-reference-corpus";
import { EvaluationReferenceManifestV3Schema } from "./evaluation-reference-corpus-local";
import { sourceReferenceForLocalFile } from "./evaluation-local-source-reference";
import { buildEvaluationScorecard } from "./evaluation-scorecard-builder";
import { loadEvaluationScorecardInput } from "./evaluation-scorecard-input";
import {
	type EvaluationScorecardArtifact,
	type EvaluationScorecardDeclaration,
} from "./evaluation-scorecard";
import {
	createEvaluationScorecardArtifact,
	loadEvaluationScorecardArtifact,
} from "./evaluation-scorecard-store";
import {
	LOCAL_SELECTION_REGION_IDS,
	controlledSourceProvenance,
	hash,
	repositoryPath,
} from "./evaluation-scorecard-verifier-controlled-support";
import {
	assertProof,
	buildControlledArtifacts,
	controlledOutputs,
	json,
	type ControlledRun,
	type JsonObject,
	verifierConfiguration,
} from "./evaluation-scorecard-verifier-support";

function buildControlledGatewayFetch(
	retainedOutputs: ReturnType<typeof controlledOutputs>,
	gatewayState: { current: number },
): typeof globalThis.fetch {
	return (_input, init) => {
		const body = typeof init?.body === "string"
			? JSON.parse(init.body) as { model?: unknown }
			: undefined;
		const metadata = typeof init?.headers === "object"
			&& init.headers !== null
			&& !Array.isArray(init.headers)
			? JSON.parse((init.headers as Record<string, string>)["cf-aig-metadata"] ?? "null") as { production_step?: unknown } | null
			: null;
		const step = typeof metadata?.production_step === "string"
			? metadata.production_step as ProductionModelStep
			: undefined;
		assertProof(typeof body?.model === "string", "Controlled Gateway request omitted its requested model");
		assertProof(
			step !== undefined && PRODUCTION_MODEL_STEPS.includes(step),
			"Controlled Gateway request omitted its production step",
		);
		gatewayState.current += 1;
		return Promise.resolve(new Response(JSON.stringify({
			id: `controlled-provider-response-${String(gatewayState.current)}`,
			object: "chat.completion",
			model: body.model,
			choices: [{ index: 0, message: { role: "assistant", content: retainedOutputs[step], refusal: null, annotations: [] }, finish_reason: "stop", logprobs: null }],
			usage: { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 },
			gatewayMetadata: { keySource: "Unified" },
		}), { headers: { "content-type": "application/json", "cf-aig-log-id": `controlled-gateway-log-${String(gatewayState.current)}` } }));
	};
}

async function writeLocalCorpusJson(
	localDataRoot: string,
	relativePath: string,
	value: unknown,
): Promise<void> {
	const absolutePath = join(localDataRoot, relativePath);
	await mkdir(dirname(absolutePath), { recursive: true });
	await writeFile(absolutePath, json(value as object), "utf8");
}

function selectionWindowForFixture(
	fixture: { messages: ReadonlyArray<{ ts: number }> },
	fixtureId: string,
): { start_utc: string; end_utc: string } {
	const timestamps = fixture.messages.map(({ ts }) => ts);
	const start = Math.min(...timestamps);
	const end = Math.max(...timestamps) + 1;
	assertProof(
		Number.isFinite(start) && Number.isFinite(end) && end > start,
		`Controlled fixture ${fixtureId} requires timestamped messages`,
	);
	return { start_utc: new Date(start).toISOString(), end_utc: new Date(end).toISOString() };
}

async function buildControlledLocalCorpus(
	localDataRoot: string,
	sourceCorpus: LoadedEvaluationReferenceCorpus,
): Promise<{ manifestPath: string }> {
	const corpusPath = "corpus";
	const localEntries = await Promise.all(
		sourceCorpus.entries.map(async (entry, index) => {
			const activeRegionId = LOCAL_SELECTION_REGION_IDS[index];
			assertProof(
				activeRegionId !== undefined,
				`Missing active region id for local scorecard fixture ${entry.manifestEntry.id}`,
			);
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
		}),
	);
	const evidenceDate = localEntries[0]?.fixture.evidence_date;
	assertProof(typeof evidenceDate === "string", "Controlled local scorecard corpus requires at least one fixture");
	const selectionPath = `${corpusPath}/selection.json`;
	await writeLocalCorpusJson(localDataRoot, selectionPath, {
		version: 1,
		id: sourceCorpus.manifest.id,
		snapshot_sha256: hash("controlled-local-selection"),
		evidence_date: evidenceDate,
		cases: localEntries.map((entry) => ({
			ordinal: entry.ordinal,
			id: entry.id,
			active_region_id: entry.fixture.active_region_id,
			windows: [selectionWindowForFixture(entry.fixture, entry.id)],
			expected_raw_count: entry.fixture.messages.length,
			expected_prepared_count: entry.preparedEvidence.final_count,
		})),
	});
	const manifestPath = `${corpusPath}/manifest.json`;
	const manifest = {
		version: 3,
		id: sourceCorpus.manifest.id,
		selection: await sourceReferenceForLocalFile(localDataRoot, selectionPath),
		fixtures: localEntries.map(({ ordinal, id, evidence, reference, variation_tags, variation_witnesses }) => ({
			ordinal,
			id,
			evidence,
			reference,
			variation_tags,
			variation_witnesses,
		})),
	};
	EvaluationReferenceManifestV3Schema.parse(manifest);
	await writeLocalCorpusJson(localDataRoot, manifestPath, manifest);
	return { manifestPath };
}

async function buildControlledLocalRuns(
	localDataRoot: string,
	manifestPath: string,
	options: { codeCommit: string },
): Promise<{ runs: ControlledRun[]; createdAt: string; annotations: JsonObject; reviews: JsonObject }> {
	const corpus = await loadLocalEvaluationReferenceCorpus(localDataRoot, manifestPath);
	const resultsDirectory = join(localDataRoot, "benchmark-runs");
	const configPath = join(localDataRoot, "benchmark.config.json");
	await mkdir(resultsDirectory, { recursive: true });
	await writeFile(configPath, json(verifierConfiguration(true)), "utf8");
	const runs: ControlledRun[] = [];
	const gatewayState = { current: 0 };
	const originalFetch = globalThis.fetch;
	try {
		for (const entry of corpus.entries) {
			const retainedOutputs = controlledOutputs(entry);
			globalThis.fetch = buildControlledGatewayFetch(retainedOutputs, gatewayState);
			const result = await evaluateBenchmarkCommand({
				fixturePath: join(localDataRoot, entry.evidencePath),
				configPath,
				resultsDirectory,
				environment: { CLOUDFLARE_ACCOUNT_ID: "controlled-account", CLOUDFLARE_API_TOKEN: "controlled-token" },
				sourceProvenance: controlledSourceProvenance(options.codeCommit),
			});
			assertProof(result.benchmark.version === 9, "Controlled current scorecard benchmark must be V9");
			runs.push({ run: result.benchmark, path: result.path, entry });
		}
	} finally {
		globalThis.fetch = originalFetch;
	}
	return { runs, ...buildControlledArtifacts(runs, corpus.manifest.id) };
}

export async function buildControlledEvaluationScorecardInputV4(
	repositoryRoot: string,
	manifestPath: string,
	localDataRoot: string,
	options: { codeCommit: string },
): Promise<{ declarationPath: string; createdAt: string }> {
	const sourceCorpus = await loadEvaluationReferenceCorpus(manifestPath, repositoryRoot);
	const { manifestPath: localManifestSourcePath } = await buildControlledLocalCorpus(localDataRoot, sourceCorpus);
	const { runs, createdAt, annotations, reviews } = await buildControlledLocalRuns(
		localDataRoot,
		localManifestSourcePath,
		{ codeCommit: options.codeCommit },
	);
	const annotationPath = join(localDataRoot, "annotations.json");
	const reviewPath = join(localDataRoot, "reviews.json");
	await Promise.all([
		writeFile(annotationPath, json(annotations), "utf8"),
		writeFile(reviewPath, json(reviews), "utf8"),
	]);
	const declarationPath = join(localDataRoot, "scorecard-input.json");
	const annotationSourcePath = repositoryPath(localDataRoot, annotationPath);
	const reviewSourcePath = repositoryPath(localDataRoot, reviewPath);
	await writeFile(declarationPath, json({
		version: 4,
		id: "controlled-v4-input",
		corpus: { source_reference: await sourceReferenceForLocalFile(localDataRoot, localManifestSourcePath) },
		configuration_identity: runs[0]!.run.declaration.configurations[0]!.identity,
		runs: await Promise.all(runs.map(async ({ run, path, entry }, index) => ({
			ordinal: index + 1,
			corpus_fixture_id: entry.manifestEntry.id,
			benchmark_run_id: run.id,
			source_reference: await sourceReferenceForLocalFile(localDataRoot, repositoryPath(localDataRoot, path)),
		}))),
		annotations: {
			source_reference: await sourceReferenceForLocalFile(localDataRoot, annotationSourcePath),
			bundle_id: annotations.id as string,
		},
		qualitative_reviews: {
			source_reference: await sourceReferenceForLocalFile(localDataRoot, reviewSourcePath),
			bundle_id: reviews.id as string,
		},
	}), "utf8");
	return { declarationPath, createdAt };
}

async function rebaseControlledScorecardDeclaration(
	sourceLocalDataRoot: string,
	targetLocalDataRoot: string,
	targetDirectory: string,
): Promise<string> {
	const sourceDeclarationPath = join(sourceLocalDataRoot, "scorecard-input.json");
	const sourceDeclaration = JSON.parse(await readFile(sourceDeclarationPath, "utf8")) as EvaluationScorecardDeclaration;
	const copiedRoot = join(targetLocalDataRoot, targetDirectory);
	await cp(sourceLocalDataRoot, copiedRoot, { recursive: true });
	const rebasePath = (path: string): string => `${targetDirectory}/${path}`;
	const rebasedManifestPath = join(copiedRoot, sourceDeclaration.corpus.source_reference.path);
	const sourceManifest = EvaluationReferenceManifestV3Schema.parse(
		JSON.parse(await readFile(rebasedManifestPath, "utf8")) as unknown,
	);
	await writeFile(rebasedManifestPath, json({
		...sourceManifest,
		selection: await sourceReferenceForLocalFile(
			targetLocalDataRoot,
			rebasePath(sourceManifest.selection.path),
		),
		fixtures: await Promise.all(sourceManifest.fixtures.map(async (fixture) => ({
			...fixture,
			evidence: await sourceReferenceForLocalFile(targetLocalDataRoot, rebasePath(fixture.evidence.path)),
			reference: await sourceReferenceForLocalFile(targetLocalDataRoot, rebasePath(fixture.reference.path)),
		}))),
	}), "utf8");
	const rebasedDeclaration: EvaluationScorecardDeclaration = {
		version: 4,
		id: sourceDeclaration.id,
		corpus: {
			source_reference: await sourceReferenceForLocalFile(
				targetLocalDataRoot,
				rebasePath(sourceDeclaration.corpus.source_reference.path),
			),
		},
		configuration_identity: sourceDeclaration.configuration_identity,
		runs: await Promise.all(sourceDeclaration.runs.map(async (run) => ({
			ordinal: run.ordinal,
			corpus_fixture_id: run.corpus_fixture_id,
			benchmark_run_id: run.benchmark_run_id,
			source_reference: await sourceReferenceForLocalFile(
				targetLocalDataRoot,
				rebasePath(run.source_reference.path),
			),
		}))),
		annotations: {
			source_reference: await sourceReferenceForLocalFile(
				targetLocalDataRoot,
				rebasePath(sourceDeclaration.annotations.source_reference.path),
			),
			bundle_id: sourceDeclaration.annotations.bundle_id,
		},
		qualitative_reviews: {
			source_reference: await sourceReferenceForLocalFile(
				targetLocalDataRoot,
				rebasePath(sourceDeclaration.qualitative_reviews.source_reference.path),
			),
			bundle_id: sourceDeclaration.qualitative_reviews.bundle_id,
		},
	};
	const rebasedDeclarationPath = join(copiedRoot, "scorecard-input.json");
	await writeFile(rebasedDeclarationPath, json(rebasedDeclaration), "utf8");
	return `${targetDirectory}/scorecard-input.json`;
}

export async function buildControlledLocalScorecard(
	repositoryRoot: string,
	manifestPath: string,
	localDataRoot: string,
	sourceWorkspaceRoot: string,
	ordinal: number,
	createdCursor: number,
	codeCommit: string,
	declarationDirectory: string = `sources/scorecard-${String(ordinal)}`,
): Promise<{ artifact: EvaluationScorecardArtifact; path: string; createdCursor: number; sourceDeclarationPath: string }> {
	const sourceLocalDataRoot = join(sourceWorkspaceRoot, `scorecard-${String(ordinal)}`, "local-data");
	const controlled = await buildControlledEvaluationScorecardInputV4(
		repositoryRoot,
		manifestPath,
		sourceLocalDataRoot,
		{ codeCommit },
	);
	const sourceDeclarationPath = await rebaseControlledScorecardDeclaration(
		sourceLocalDataRoot,
		localDataRoot,
		declarationDirectory,
	);
	const input = await loadEvaluationScorecardInput(sourceDeclarationPath, localDataRoot);
	const created = Math.max(Date.parse(controlled.createdAt), createdCursor + 1);
	const artifact = buildEvaluationScorecard(input, {
		id: `controlled-scorecard-${String(ordinal)}`,
		createdAt: new Date(created).toISOString(),
	});
	const path = join(localDataRoot, "scorecards", `${artifact.id}.json`);
	await mkdir(dirname(path), { recursive: true });
	await createEvaluationScorecardArtifact(path, artifact, { repositoryRoot, localDataRoot });
	const loaded = await loadEvaluationScorecardArtifact(
		artifact.id,
		join(localDataRoot, "scorecards"),
		{ repositoryRoot, localDataRoot },
	);
	assertProof(loaded.version === 4, `Controlled scorecard ${String(ordinal)} did not retain V4 local-data evidence`);
	return { artifact: loaded, path, createdCursor: created, sourceDeclarationPath };
}
