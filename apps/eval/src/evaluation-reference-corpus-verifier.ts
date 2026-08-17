import { execFile } from "node:child_process";
import { copyFile, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runEvalCliApplication } from "./cli";
import {
	EvaluationReferenceManifestSchema,
	loadEvaluationReferenceCorpus,
	loadLocalEvaluationReferenceCorpus,
	loadLocalEvaluationReferenceCorpusAtReference,
} from "./evaluation-reference-corpus";
import { listEvaluationLocalSources, sourceReferenceForLocalFile } from "./evaluation-local-source-reference";
import { EVALUATION_CORPUS_VARIATION_TAGS } from "./evaluation-reference-corpus";
import { RepositorySourceReferenceSchema, readRepositorySource } from "./evaluation-repository-reference";
import { initializeControlledEvaluationRepository } from "./evaluation-scorecard-verifier";

const execFileAsync = promisify(execFile);
const FIXTURE_IDS = ["dense-market-day", "sparse-repair-update"] as const;

function assertProof(condition: boolean, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function git(root: string, ...args: string[]): Promise<void> {
	await execFileAsync("git", ["-C", root, ...args]);
}

async function invokeCli(argv: readonly string[], repositoryRoot: string): Promise<string> {
	let output = "";
	await runEvalCliApplication({
		argv,
		currentDirectory: repositoryRoot,
		appDirectory: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
		environment: { INIT_CWD: repositoryRoot },
		writeOutput: (text) => { output += text; },
	});
	return output;
}

async function expectRejected(action: () => Promise<unknown>, message: string): Promise<void> {
	let rejected = false;
	try {
		await action();
	} catch {
		rejected = true;
	}
	assertProof(rejected, message);
}

async function writeJson(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function buildLocalCorpus(localDataRoot: string, corpusPath: string): Promise<{ manifestPath: string; manifestReference: Awaited<ReturnType<typeof sourceReferenceForLocalFile>> }> {
	const fixtureRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/fixtures/evaluation-corpus");
	const sourceManifest = EvaluationReferenceManifestSchema.parse(JSON.parse(await readFile(join(fixtureRoot, "manifest.json"), "utf8")) as unknown);
	const sourceEntries = new Map(sourceManifest.fixtures.map((entry) => [entry.id, entry]));
	const fixtures = [];
	for (const [index, id] of FIXTURE_IDS.entries()) {
		const sourceEntry = sourceEntries.get(id);
		assertProof(sourceEntry !== undefined, `Fixture ${id} is missing from the synthetic source corpus`);
		const evidencePath = `${corpusPath}/evidence/${id}.json`;
		const referencePath = `${corpusPath}/references/${id}.json`;
		await mkdir(dirname(join(localDataRoot, evidencePath)), { recursive: true });
		await mkdir(dirname(join(localDataRoot, referencePath)), { recursive: true });
		await copyFile(join(fixtureRoot, "evidence", `${id}.json`), join(localDataRoot, evidencePath));
		await copyFile(join(fixtureRoot, "references", `${id}.json`), join(localDataRoot, referencePath));
		fixtures.push({
			ordinal: index + 1,
			id,
			evidence: await sourceReferenceForLocalFile(localDataRoot, evidencePath),
			reference: await sourceReferenceForLocalFile(localDataRoot, referencePath),
			variation_tags: sourceEntry.variation_tags,
			variation_witnesses: sourceEntry.variation_witnesses,
		});
	}
	const manifestPath = `${corpusPath}/manifest.json`;
	await writeJson(join(localDataRoot, manifestPath), { version: 3, id: `${corpusPath.replaceAll("/", "-")}-v3`, fixtures });
	return { manifestPath, manifestReference: await sourceReferenceForLocalFile(localDataRoot, manifestPath) };
}

async function verifyRepositoryCorpus(repositoryRoot: string, manifestPath: string): Promise<void> {
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
	await expectRejected(() => readRepositorySource(repositoryRoot, { ...corpus.sourceReference, path: "packages/fixtures/evaluation-corpus/missing.json" }), "Missing committed corpus source was accepted");
	await writeFile(join(repositoryRoot, "unrelated.txt"), "advanced checkout\n", "utf8");
	await git(repositoryRoot, "add", "unrelated.txt");
	await git(repositoryRoot, "commit", "-m", "Advance corpus checkout");
	const cliReport = await invokeCli(["corpus", "show", "--corpus", "packages/fixtures/evaluation-corpus/manifest.json"], repositoryRoot);
	assertProof(cliReport.includes("Evaluation reference corpus v2") && cliReport.includes("Fixtures: 12") && cliReport.includes("Source:"), "Corpus CLI show did not render committed corpus semantics after checkout advanced");
	const unchangedCorpus = await loadEvaluationReferenceCorpus(manifestPath, repositoryRoot);
	assertProof(unchangedCorpus.sourceReference.commit_sha === corpus.sourceReference.commit_sha, "Unrelated repository commit changed corpus truth identity");
	const originalManifestText = await readFile(manifestPath, "utf8");
	await writeFile(manifestPath, `${originalManifestText.trimEnd()}\n\n`, "utf8");
	await git(repositoryRoot, "add", manifestPath);
	await git(repositoryRoot, "commit", "-m", "Revise valid corpus source");
	const revisedCorpus = await loadEvaluationReferenceCorpus(manifestPath, repositoryRoot);
	assertProof(revisedCorpus.sourceReference.commit_sha !== corpus.sourceReference.commit_sha, "Valid corpus source revision did not change corpus truth identity");
	const manifest = EvaluationReferenceManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")) as unknown);
	const firstReferencePath = join(repositoryRoot, manifest.fixtures[0]!.reference_path);
	const reference = JSON.parse(await readFile(firstReferencePath, "utf8")) as Record<string, unknown>;
	reference.fixture_id = "detached-fixture";
	await writeFile(firstReferencePath, `${JSON.stringify(reference, null, 2)}\n`, "utf8");
	await git(repositoryRoot, "add", ".");
	await git(repositoryRoot, "commit", "-m", "Introduce controlled semantic mismatch");
	await expectRejected(() => loadEvaluationReferenceCorpus(manifestPath, repositoryRoot), "Corpus semantic identity mismatch was accepted");
}

async function verifyLocalCorpus(localDataRoot: string): Promise<void> {
	const primary = await buildLocalCorpus(localDataRoot, "corpora/primary");
	const corpus = await loadLocalEvaluationReferenceCorpus(localDataRoot, primary.manifestPath);
	assertProof(corpus.manifest.version === 3 && corpus.entries.length === FIXTURE_IDS.length, "Local reference corpus did not load the declared fixtures");
	assertProof(corpus.entries.every(({ manifestEntry, reference }) => manifestEntry.id === reference.fixture_id), "Local corpus semantic fixture identities are detached");
	assertProof(corpus.manifest.fixtures.every(({ ordinal }, index) => ordinal === index + 1), "Local corpus fixture order is not contiguous");
	assertProof((await listEvaluationLocalSources(localDataRoot, "corpora/primary")).join("|") === [
		"corpora/primary/evidence/dense-market-day.json",
		"corpora/primary/evidence/sparse-repair-update.json",
		"corpora/primary/manifest.json",
		"corpora/primary/references/dense-market-day.json",
		"corpora/primary/references/sparse-repair-update.json",
	].join("|"), "Local corpus listing was not deterministic");

	const relocated = await buildLocalCorpus(localDataRoot, "archive/relocated");
	const relocatedCorpus = await loadLocalEvaluationReferenceCorpus(localDataRoot, relocated.manifestPath);
	assertProof(relocatedCorpus.manifest.id !== corpus.manifest.id && relocatedCorpus.entries.map(({ manifestEntry }) => manifestEntry.id).join("|") === corpus.entries.map(({ manifestEntry }) => manifestEntry.id).join("|"), "Relocated local corpus did not preserve the declared roster");

	for (const path of ["/absolute/manifest.json", "corpora\\primary\\manifest.json", "../corpora/primary/manifest.json", "corpora/./primary/manifest.json"]) {
		await expectRejected(() => sourceReferenceForLocalFile(localDataRoot, path), `Invalid local source path was accepted: ${path}`);
	}
	await expectRejected(() => sourceReferenceForLocalFile(localDataRoot, "corpora/primary/missing.json"), "Missing local source was accepted");
	await expectRejected(() => sourceReferenceForLocalFile(localDataRoot, "corpora/primary/evidence"), "Local directory was accepted as a regular file");

	await symlink(join(localDataRoot, "corpora", "primary"), join(localDataRoot, "linked-corpus"));
	await expectRejected(() => sourceReferenceForLocalFile(localDataRoot, "linked-corpus/manifest.json"), "Ancestor symlink local source was accepted");
	await mkdir(join(localDataRoot, "leaf-link"), { recursive: true });
	await symlink(join(localDataRoot, "corpora", "primary", "manifest.json"), join(localDataRoot, "leaf-link", "manifest.json"));
	await expectRejected(() => sourceReferenceForLocalFile(localDataRoot, "leaf-link/manifest.json"), "Leaf symlink local source was accepted");

	const staleChild = await buildLocalCorpus(localDataRoot, "corpora/stale-child");
	await writeFile(join(localDataRoot, "corpora/stale-child/evidence/dense-market-day.json"), `${await readFile(join(localDataRoot, "corpora/stale-child/evidence/dense-market-day.json"), "utf8")}\n`, "utf8");
	await expectRejected(() => loadLocalEvaluationReferenceCorpusAtReference(localDataRoot, staleChild.manifestReference), "Local child digest mismatch was accepted");

	const staleManifest = await buildLocalCorpus(localDataRoot, "corpora/stale-manifest");
	await writeFile(join(localDataRoot, staleManifest.manifestPath), `${await readFile(join(localDataRoot, staleManifest.manifestPath), "utf8")}\n`, "utf8");
	await expectRejected(() => loadLocalEvaluationReferenceCorpusAtReference(localDataRoot, staleManifest.manifestReference), "Local manifest digest mismatch was accepted");

	const undeclared = await buildLocalCorpus(localDataRoot, "corpora/undeclared");
	await writeFile(join(localDataRoot, "corpora/undeclared/notes.txt"), "undeclared\n", "utf8");
	await expectRejected(() => loadLocalEvaluationReferenceCorpus(localDataRoot, undeclared.manifestPath), "Undeclared local corpus file was accepted");
}

export async function verifyEvaluationReferenceCorpus(temporaryRoot?: string): Promise<string> {
	const root = temporaryRoot ?? await mkdtemp(join(tmpdir(), "bc-news-reference-corpus-"));
	const cleanup = temporaryRoot === undefined;
	try {
		const repositoryRoot = join(root, "repository");
		const localDataRoot = join(root, "local-data");
		const source = resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/fixtures/evaluation-corpus");
		const { manifestPath } = await initializeControlledEvaluationRepository(repositoryRoot, source);
		await verifyRepositoryCorpus(repositoryRoot, manifestPath);
		await verifyLocalCorpus(localDataRoot);
		return "EVALUATION REFERENCE CORPUS VERIFIED";
	} finally {
		if (cleanup) await rm(root, { recursive: true, force: true });
	}
}

async function main(): Promise<void> {
	process.stdout.write(`${await verifyEvaluationReferenceCorpus()}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
