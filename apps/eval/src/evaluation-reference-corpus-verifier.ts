import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { EvidenceFixtureSchema } from "@bc-news/contracts";
import { runEvalCliApplication } from "./cli";
import {
	EvaluationReferenceManifestSchema,
	loadEvaluationReferenceCorpus,
	loadLocalEvaluationReferenceCorpus,
	loadLocalEvaluationReferenceCorpusAtReference,
} from "./evaluation-reference-corpus";
import {
	controlledReferenceCorpusFixtures,
	writeControlledRepositoryReferenceCorpus,
} from "./evaluation-reference-corpus-controlled";
import { listEvaluationLocalSources, sourceReferenceForLocalFile } from "./evaluation-local-source-reference";
import { EVALUATION_CORPUS_VARIATION_TAGS } from "./evaluation-reference-corpus";
import { RepositorySourceReferenceSchema, readRepositorySource } from "./evaluation-repository-reference";
import {
	assertProof,
	buildLocalCorpus,
	expectRejected,
	expectedLocalCorpusPaths,
	localSparseFixture,
	readJson,
	rewriteManifest,
	rewriteSelection,
	withExpandedSparseWitness,
	writeJson,
} from "./evaluation-reference-corpus-verifier-support";

const execFileAsync = promisify(execFile);
const SPARSE_FIXTURE_ID = "sparse-repair-update";
const CONTROLLED_FIXTURE_IDS = controlledReferenceCorpusFixtures().map(({ id }) => id);

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

async function initializeControlledRepository(root: string): Promise<{ manifestPath: string; corpusRoot: string }> {
	await mkdir(root, { recursive: true });
	await git(root, "init", "-b", "main");
	await git(root, "config", "user.email", "reference-corpus-verifier@example.invalid");
	await git(root, "config", "user.name", "Reference Corpus Verifier");
	const written = await writeControlledRepositoryReferenceCorpus(root);
	await git(root, "add", "packages/fixtures/evaluation-corpus");
	await git(root, "commit", "-m", "Add controlled evaluation corpus");
	return written;
}

async function verifyRepositoryCorpus(repositoryRoot: string, manifestPath: string): Promise<void> {
	const corpus = await loadEvaluationReferenceCorpus(manifestPath, repositoryRoot);
	assertProof(corpus.manifest.version === 2 && corpus.entries.length === 12, "Current reference corpus did not load all twelve fixtures");
	assertProof(corpus.manifest.fixtures.every(({ ordinal }, index) => ordinal === index + 1), "Corpus fixture order is not contiguous");
	assertProof(corpus.manifest.fixtures.map(({ id }) => id).join("|") === CONTROLLED_FIXTURE_IDS.join("|"), "Corpus fixture roster escaped the controlled synthetic set");
	assertProof(corpus.entries.every(({ manifestEntry, reference }) => manifestEntry.id === reference.fixture_id), "Corpus semantic fixture identities are detached");
	assertProof(
		corpus.entries.some(({ reference }) => reference.event_relationships.some(({ kind }) => kind === "overlaps"))
			&& corpus.entries.some(({ reference }) => reference.event_relationships.some(({ kind }) => kind === "isolated")),
		"Corpus relationship coverage is incomplete",
	);
	const coverage = new Set(corpus.manifest.fixtures.flatMap(({ variation_tags }) => variation_tags));
	assertProof(EVALUATION_CORPUS_VARIATION_TAGS.every((tag) => coverage.has(tag)), "Corpus variation coverage is incomplete");
	assertProof(
		corpus.entries.every(({ reference }) => [...reference.claims, ...reference.events].every((record) => (
			record.status === "established"
				? record.supporting_witnesses.length > 0
				: record.status === "contested"
					? record.supporting_witnesses.length > 0 && record.opposing_witnesses.length > 0
					: record.unresolved_witnesses.length > 0
		))),
		"Corpus status grounding shape is incomplete",
	);
	const serialized = JSON.stringify(corpus.manifest);
	assertProof(
		!serialized.includes("sha256")
			&& corpus.manifest.fixtures.every(({ evidence_path, reference_path }) => evidence_path.startsWith("packages/") && reference_path.startsWith("packages/")),
		"Corpus V2 retained byte hashes or non-repository paths",
	);
	assertProof(
		RepositorySourceReferenceSchema.safeParse({ repository: "bc-news", commit_sha: "1".repeat(40), path: "../escape.json" }).success === false,
		"Repository reference accepted path traversal",
	);
	await expectRejected(
		() => readRepositorySource(repositoryRoot, { ...corpus.sourceReference, path: "packages/fixtures/evaluation-corpus/missing.json" }),
		"Missing committed corpus source was accepted",
	);
	await writeFile(join(repositoryRoot, "unrelated.txt"), "advanced checkout\n", "utf8");
	await git(repositoryRoot, "add", "unrelated.txt");
	await git(repositoryRoot, "commit", "-m", "Advance corpus checkout");
	const cliReport = await invokeCli(["corpus", "show", "--corpus", "packages/fixtures/evaluation-corpus/manifest.json"], repositoryRoot);
	assertProof(
		cliReport.includes("Evaluation reference corpus v2") && cliReport.includes("Fixtures: 12") && cliReport.includes("Source:"),
		"Corpus CLI show did not render committed corpus semantics after checkout advanced",
	);
	const unchangedCorpus = await loadEvaluationReferenceCorpus(manifestPath, repositoryRoot);
	assertProof(unchangedCorpus.sourceReference.commit_sha === corpus.sourceReference.commit_sha, "Unrelated repository commit changed corpus truth identity");
	const originalManifestText = await readFile(manifestPath, "utf8");
	await writeFile(manifestPath, `${originalManifestText.trimEnd()}\n\n`, "utf8");
	await git(repositoryRoot, "add", manifestPath);
	await git(repositoryRoot, "commit", "-m", "Revise valid corpus source");
	const revisedCorpus = await loadEvaluationReferenceCorpus(manifestPath, repositoryRoot);
	assertProof(revisedCorpus.sourceReference.commit_sha !== corpus.sourceReference.commit_sha, "Valid corpus source revision did not change corpus truth identity");
	const manifest = EvaluationReferenceManifestSchema.parse(await readJson(manifestPath));
	const firstReferencePath = join(repositoryRoot, manifest.fixtures[0]!.reference_path);
	const reference = await readJson<Record<string, unknown>>(firstReferencePath);
	reference.fixture_id = "detached-fixture";
	await writeJson(firstReferencePath, reference);
	await git(repositoryRoot, "add", ".");
	await git(repositoryRoot, "commit", "-m", "Introduce controlled semantic mismatch");
	await expectRejected(() => loadEvaluationReferenceCorpus(manifestPath, repositoryRoot), "Corpus semantic identity mismatch was accepted");
}

async function verifyRepositorySparseRule(repositoryRoot: string, manifestPath: string, corpusRoot: string): Promise<void> {
	const manifest = EvaluationReferenceManifestSchema.parse(await readJson(manifestPath));
	const sparseEvidencePath = join(corpusRoot, "evidence", `${SPARSE_FIXTURE_ID}.json`);
	const sparseFixture = EvidenceFixtureSchema.parse(await readJson(sparseEvidencePath));
	await writeJson(sparseEvidencePath, localSparseFixture(sparseFixture));
	await writeJson(manifestPath, {
		...manifest,
		fixtures: manifest.fixtures.map((entry) => entry.id === SPARSE_FIXTURE_ID
			? { ...entry, variation_witnesses: withExpandedSparseWitness(entry.variation_witnesses) }
			: entry),
	});
	await git(repositoryRoot, "add", manifestPath, sparseEvidencePath);
	await git(repositoryRoot, "commit", "-m", "Expand sparse repository fixture");
	await expectRejected(() => loadEvaluationReferenceCorpus(manifestPath, repositoryRoot), "Repository corpus accepted sparse fixture above six prepared messages");
}

async function verifyLocalCorpus(localDataRoot: string): Promise<void> {
	const primary = await buildLocalCorpus(localDataRoot, "corpora/primary");
	const corpus = await loadLocalEvaluationReferenceCorpus(localDataRoot, primary.manifestPath);
	assertProof(corpus.manifest.version === 3 && corpus.entries.length === 12, "Local reference corpus did not load the declared fixtures");
	assertProof(corpus.selectionPath === "corpora/primary/selection.json", "Local corpus selection path was not canonical");
	assertProof(corpus.manifest.fixtures.map(({ id }) => id).join("|") === CONTROLLED_FIXTURE_IDS.join("|"), "Local corpus fixture roster escaped the controlled synthetic set");
	assertProof(Buffer.from(corpus.selectionBytes).equals(await readFile(join(localDataRoot, corpus.selectionPath))), "Local corpus did not expose exact selection bytes");
	assertProof(corpus.selection.id === corpus.manifest.id, "Local corpus did not bind manifest id to selection id");
	assertProof(corpus.entries.every(({ manifestEntry, reference }) => manifestEntry.id === reference.fixture_id), "Local corpus semantic fixture identities are detached");
	assertProof(corpus.manifest.fixtures.every(({ ordinal }, index) => ordinal === index + 1), "Local corpus fixture order is not contiguous");
	assertProof(
		(await listEvaluationLocalSources(localDataRoot, "corpora/primary")).join("|")
			=== expectedLocalCorpusPaths("corpora/primary", corpus.manifest.fixtures.map(({ id }) => id)).join("|"),
		"Local corpus listing was not deterministic",
	);
	const sparseEntry = corpus.entries.find(({ manifestEntry }) => manifestEntry.id === SPARSE_FIXTURE_ID);
	assertProof(sparseEntry !== undefined && sparseEntry.preparedEvidence.final_count === 8, "Local V3 sparse corpus did not admit the eight-message sparse case");
	assertProof(sparseEntry.manifestEntry.variation_witnesses.find(({ tag }) => tag === "sparse")?.message_ids.length === 8, "Local V3 sparse witness roster was not exact");
	const localCoverage = new Set(corpus.manifest.fixtures.flatMap(({ variation_tags }) => variation_tags));
	assertProof(EVALUATION_CORPUS_VARIATION_TAGS.every((tag) => localCoverage.has(tag)), "Local V3 corpus variation coverage is incomplete");

	const relocated = await buildLocalCorpus(localDataRoot, "archive/relocated");
	const relocatedCorpus = await loadLocalEvaluationReferenceCorpus(localDataRoot, relocated.manifestPath);
	assertProof(
		relocatedCorpus.manifest.id !== corpus.manifest.id
			&& relocatedCorpus.entries.map(({ manifestEntry }) => manifestEntry.id).join("|") === corpus.entries.map(({ manifestEntry }) => manifestEntry.id).join("|"),
		"Relocated local corpus did not preserve the declared roster",
	);

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

	const staleSelection = await buildLocalCorpus(localDataRoot, "corpora/stale-selection");
	await writeFile(join(localDataRoot, staleSelection.selectionPath), `${await readFile(join(localDataRoot, staleSelection.selectionPath), "utf8")}\n`, "utf8");
	await expectRejected(() => loadLocalEvaluationReferenceCorpusAtReference(localDataRoot, staleSelection.manifestReference), "Local selection digest mismatch was accepted");

	const swappedSelection = await buildLocalCorpus(localDataRoot, "corpora/swapped-selection");
	await rewriteSelection(localDataRoot, swappedSelection.manifestPath, (selection) => {
		const cases = [...(selection.cases as Record<string, unknown>[])];
		[cases[0], cases[1]] = [cases[1]!, cases[0]!];
		selection.cases = cases;
	});
	await expectRejected(() => loadLocalEvaluationReferenceCorpus(localDataRoot, swappedSelection.manifestPath), "Selection case reorder was accepted");

	const narrowedWindow = await buildLocalCorpus(localDataRoot, "corpora/narrowed-window");
	await rewriteSelection(localDataRoot, narrowedWindow.manifestPath, (selection) => {
		const cases = selection.cases as Array<Record<string, unknown>>;
		const windows = [...(cases[0]!.windows as Array<Record<string, unknown>>)];
		const startUtc = windows[0]!.start_utc as string;
		windows[0] = { ...windows[0]!, end_utc: new Date(Date.parse(startUtc) + 1).toISOString() };
		cases[0] = { ...cases[0]!, windows };
		selection.cases = cases;
	});
	await expectRejected(() => loadLocalEvaluationReferenceCorpus(localDataRoot, narrowedWindow.manifestPath), "Selection window mismatch was accepted");

	const wrongCount = await buildLocalCorpus(localDataRoot, "corpora/wrong-count");
	await rewriteSelection(localDataRoot, wrongCount.manifestPath, (selection) => {
		const cases = selection.cases as Array<Record<string, unknown>>;
		cases[1] = { ...cases[1]!, expected_prepared_count: 7 };
		selection.cases = cases;
	});
	await expectRejected(() => loadLocalEvaluationReferenceCorpus(localDataRoot, wrongCount.manifestPath), "Selection count mismatch was accepted");

	const missingCoverage = await buildLocalCorpus(localDataRoot, "corpora/missing-coverage");
	await rewriteManifest(localDataRoot, missingCoverage.manifestPath, (manifest) => {
		manifest.fixtures = (manifest.fixtures as Array<Record<string, unknown>>).map((entry) => entry.id === "overlapping-deliveries"
			? {
				...entry,
				variation_tags: ["numbers", "names"],
				variation_witnesses: (entry.variation_witnesses as Array<Record<string, unknown>>).filter((witness) => witness.tag !== "overlapping_events"),
			}
			: entry);
	});
	await expectRejected(() => loadLocalEvaluationReferenceCorpus(localDataRoot, missingCoverage.manifestPath), "Local coverage gap was accepted");

	const undeclared = await buildLocalCorpus(localDataRoot, "corpora/undeclared");
	await writeFile(join(localDataRoot, "corpora/undeclared/notes.txt"), "undeclared\n", "utf8");
	await expectRejected(() => loadLocalEvaluationReferenceCorpus(localDataRoot, undeclared.manifestPath), "Undeclared local corpus file was accepted");
}

export async function verifyEvaluationReferenceCorpus(temporaryRoot?: string): Promise<string> {
	const root = temporaryRoot ?? await mkdtemp(join(tmpdir(), "bc-news-reference-corpus-"));
	const cleanup = temporaryRoot === undefined;
	try {
		const repositoryRoot = join(root, "repository");
		const repositorySparseRoot = join(root, "repository-sparse-rule");
		const localDataRoot = join(root, "local-data");
		const { manifestPath } = await initializeControlledRepository(repositoryRoot);
		await verifyRepositoryCorpus(repositoryRoot, manifestPath);
		const sparseRule = await initializeControlledRepository(repositorySparseRoot);
		await verifyRepositorySparseRule(repositorySparseRoot, sparseRule.manifestPath, sparseRule.corpusRoot);
		await verifyLocalCorpus(localDataRoot);
		return "EVALUATION REFERENCE CORPUS VERIFIED";
	} finally {
		if (cleanup) {
			await rm(root, { recursive: true, force: true });
		}
	}
}

async function main(): Promise<void> {
	process.stdout.write(`${await verifyEvaluationReferenceCorpus()}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	void main();
}
