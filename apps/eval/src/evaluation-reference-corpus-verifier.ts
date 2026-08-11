import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runEvalCliApplication } from "./cli";
import { EVALUATION_CORPUS_VARIATION_TAGS } from "./evaluation-reference-corpus";
import { EvaluationReferenceManifestSchema, loadEvaluationReferenceCorpus } from "./evaluation-reference-corpus";
import { RepositorySourceReferenceSchema, readRepositorySource } from "./evaluation-repository-reference";
import { initializeControlledEvaluationRepository } from "./evaluation-scorecard-verifier";

const execFileAsync = promisify(execFile);
function assertProof(condition: boolean, message: string): asserts condition { if (!condition) throw new Error(message); }
async function git(root: string, ...args: string[]): Promise<void> { await execFileAsync("git", ["-C", root, ...args]); }
async function invokeCli(argv: readonly string[], repositoryRoot: string): Promise<string> {
	let output = "";
	await runEvalCliApplication({ argv, currentDirectory: repositoryRoot, appDirectory: resolve(dirname(fileURLToPath(import.meta.url)), ".."), environment: { INIT_CWD: repositoryRoot }, writeOutput: (text) => { output += text; } });
	return output;
}

export async function verifyEvaluationReferenceCorpus(temporaryRoot?: string): Promise<string> {
	const root = temporaryRoot ?? await mkdtemp(join(tmpdir(), "bc-news-reference-corpus-")); const cleanup = temporaryRoot === undefined;
	try {
		const repositoryRoot = join(root, "repository");
		const source = resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/fixtures/evaluation-corpus");
		const { manifestPath } = await initializeControlledEvaluationRepository(repositoryRoot, source);
		const corpus = await loadEvaluationReferenceCorpus(manifestPath, repositoryRoot);
		assertProof(corpus.manifest.version === 2 && corpus.entries.length === 12, "Current reference corpus did not load all twelve fixtures");
		assertProof(corpus.manifest.fixtures.every(({ ordinal }, index) => ordinal === index + 1), "Corpus fixture order is not contiguous");
		assertProof(corpus.entries.every(({ manifestEntry, reference }) => manifestEntry.id === reference.fixture_id), "Corpus semantic fixture identities are detached");
		assertProof(corpus.entries.some(({ reference }) => reference.event_relationships.some(({ kind }) => kind === "overlaps")) && corpus.entries.some(({ reference }) => reference.event_relationships.some(({ kind }) => kind === "isolated")), "Corpus relationship coverage is incomplete");
		const coverage = new Set(corpus.manifest.fixtures.flatMap(({ variation_tags }) => variation_tags));
		assertProof(EVALUATION_CORPUS_VARIATION_TAGS.every((tag) => coverage.has(tag)), "Corpus variation coverage is incomplete");
		assertProof(corpus.entries.every(({ reference }) => [...reference.claims, ...reference.events].every((record) => record.status === "established" ? record.supporting_witnesses.length > 0 : record.status === "contested" ? record.supporting_witnesses.length > 0 && record.opposing_witnesses.length > 0 : record.unresolved_witnesses.length > 0)), "Corpus status grounding shape is incomplete");
		const serialized = JSON.stringify(corpus.manifest);
		assertProof(!serialized.includes("sha256") && corpus.manifest.fixtures.every(({ evidence_path, reference_path }) => evidence_path.startsWith("packages/") && reference_path.startsWith("packages/")), "Corpus V2 retained byte hashes or non-repository paths");
		assertProof(RepositorySourceReferenceSchema.safeParse({ repository: "bc-news", commit_sha: "1".repeat(40), path: "../escape.json" }).success === false, "Repository reference accepted path traversal");
		let missing = false; try { await readRepositorySource(repositoryRoot, { ...corpus.sourceReference, path: "packages/fixtures/evaluation-corpus/missing.json" }); } catch { missing = true; }
		assertProof(missing, "Missing committed corpus source was accepted");
		await writeFile(join(repositoryRoot, "unrelated.txt"), "advanced checkout\n", "utf8"); await git(repositoryRoot, "add", "unrelated.txt"); await git(repositoryRoot, "commit", "-m", "Advance corpus checkout");
		const cliReport = await invokeCli(["corpus", "show", "--corpus", "packages/fixtures/evaluation-corpus/manifest.json"], repositoryRoot);
		assertProof(cliReport.includes("Evaluation reference corpus v2") && cliReport.includes("Fixtures: 12") && cliReport.includes("Source:"), "Corpus CLI show did not render committed corpus semantics after checkout advanced");
		const unchangedCorpus = await loadEvaluationReferenceCorpus(manifestPath, repositoryRoot);
		assertProof(unchangedCorpus.sourceReference.commit_sha === corpus.sourceReference.commit_sha, "Unrelated repository commit changed corpus truth identity");
		const originalManifestText = await readFile(manifestPath, "utf8"); await writeFile(manifestPath, `${originalManifestText.trimEnd()}\n\n`, "utf8");
		await git(repositoryRoot, "add", manifestPath); await git(repositoryRoot, "commit", "-m", "Revise valid corpus source");
		const revisedCorpus = await loadEvaluationReferenceCorpus(manifestPath, repositoryRoot);
		assertProof(revisedCorpus.sourceReference.commit_sha !== corpus.sourceReference.commit_sha, "Valid corpus source revision did not change corpus truth identity");
		const manifest = EvaluationReferenceManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")) as unknown);
		const firstReferencePath = join(repositoryRoot, manifest.fixtures[0]!.reference_path); const reference = JSON.parse(await readFile(firstReferencePath, "utf8")) as Record<string, unknown>;
		reference.fixture_id = "detached-fixture"; await writeFile(firstReferencePath, `${JSON.stringify(reference, null, 2)}\n`, "utf8"); await git(repositoryRoot, "add", "."); await git(repositoryRoot, "commit", "-m", "Introduce controlled semantic mismatch");
		let rejected = false; try { await loadEvaluationReferenceCorpus(manifestPath, repositoryRoot); } catch { rejected = true; }
		assertProof(rejected, "Corpus semantic identity mismatch was accepted");
		return "EVALUATION REFERENCE CORPUS VERIFIED";
	} finally { if (cleanup) await rm(root, { recursive: true, force: true }); }
}

async function main(): Promise<void> { process.stdout.write(`${await verifyEvaluationReferenceCorpus()}\n`); }
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
