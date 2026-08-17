import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, promisify } from "node:util";
import { execFile } from "node:child_process";
import { evaluationRepositoryHead } from "./evaluation-repository-reference";
import { buildEvaluationScorecard } from "./evaluation-scorecard-builder";
import { buildEvaluationScorecardV2 } from "./evaluation-scorecard-builder-v2";
import { loadEvaluationScorecardInput } from "./evaluation-scorecard-input";
import { loadEvaluationScorecardInput as loadEvaluationScorecardInputV2 } from "./evaluation-scorecard-input-v2";
import { formatEvaluationScorecardReport } from "./evaluation-scorecard-report";
import { createEvaluationScorecardArtifact, evaluationScorecardFreshness, loadEvaluationScorecardArtifact } from "./evaluation-scorecard-store";
import {
	buildControlledEvaluationScorecardInputV2,
	buildControlledEvaluationScorecardInputV3,
	gatewayRequestHashesForStep,
	gatewayRequestSha256,
	gatewayRequestSha256s,
	initializeControlledEvaluationRepository,
} from "./evaluation-scorecard-verifier-controlled";
export { initializeControlledEvaluationRepository } from "./evaluation-scorecard-verifier-controlled";

type JsonObject = Record<string, unknown>;
const execFileAsync = promisify(execFile);

function json(value: object): string { return `${JSON.stringify(value, null, 2)}\n`; }
function assertProof(condition: boolean, message: string): asserts condition { if (!condition) throw new Error(message); }
function repositoryPath(root: string, path: string): string { return path.slice(root.length + 1).split("\\").join("/"); }
async function git(root: string, ...args: string[]): Promise<string> {
	const { stdout } = await execFileAsync("git", ["-C", root, ...args], { encoding: "utf8" });
	return stdout.trim();
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
		const originalRunPath = declarationJson.runs[0]!.source_reference.path;
		declarationJson.runs[0]!.source_reference.path = "../escape.json";
		await writeFile(restored.declarationPath, json(declarationJson), "utf8");
		let traversalRejected = false; try { await loadEvaluationScorecardInput(restoredDeclarationSourcePath, localDataRoot); } catch { traversalRejected = true; }
		assertProof(traversalRejected, "Traversal source reference was accepted");
		declarationJson.runs[0]!.source_reference.path = originalRunPath;
		await writeFile(restored.declarationPath, json(declarationJson), "utf8");
		const localManifestJson = JSON.parse(await readFile(join(localDataRoot, "corpus/manifest.json"), "utf8")) as JsonObject;
		await writeFile(join(localDataRoot, "corpus/manifest.json"), json({
			version: 2,
			id: localManifestJson.id,
			fixtures: (localManifestJson.fixtures as Array<{ ordinal: number; id: string; variation_tags: unknown; variation_witnesses: unknown }>).map((fixture) => ({
				ordinal: fixture.ordinal,
				id: fixture.id,
				evidence_path: `corpus/evidence/${fixture.id}.json`,
				reference_path: `corpus/references/${fixture.id}.json`,
				variation_tags: fixture.variation_tags,
				variation_witnesses: fixture.variation_witnesses,
			})),
		}), "utf8");
		let v2LocalManifestRejected = false; try { await loadEvaluationScorecardInput(restoredDeclarationSourcePath, localDataRoot); } catch { v2LocalManifestRejected = true; }
		assertProof(v2LocalManifestRejected, "V2-shaped local corpus manifest was accepted");
		await writeFile(join(localDataRoot, "corpus/manifest.json"), json(localManifestJson), "utf8");
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
