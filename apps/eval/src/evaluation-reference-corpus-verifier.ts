import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { ACTIVE_REGION_IDS, EvidenceFixtureSchema, type EvidenceFixture } from "@bc-news/contracts";
import { prepareEvidence, type PreparedEvidence } from "@bc-news/generation-core";
import { runEvalCliApplication } from "./cli";
import {
	EvaluationReferenceManifestSchema,
	EvaluationReferenceManifestV3Schema,
	loadEvaluationReferenceCorpus,
	loadLocalEvaluationReferenceCorpus,
	loadLocalEvaluationReferenceCorpusAtReference,
} from "./evaluation-reference-corpus";
import { listEvaluationLocalSources, sourceReferenceForLocalFile } from "./evaluation-local-source-reference";
import { EVALUATION_CORPUS_VARIATION_TAGS } from "./evaluation-reference-corpus";
import { RepositorySourceReferenceSchema, readRepositorySource } from "./evaluation-repository-reference";
import { initializeControlledEvaluationRepository } from "./evaluation-scorecard-verifier";

const execFileAsync = promisify(execFile);
const LOCAL_SELECTION_REGION_IDS = ACTIVE_REGION_IDS.slice(0, 12);
const SPARSE_FIXTURE_ID = "sparse-repair-update";
const SOURCE_FIXTURE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/fixtures/evaluation-corpus");
const EXTRA_SPARSE_MESSAGES: EvidenceFixture["messages"] = [
	{ id: "repair-05", ts: 1780283040000, author_id: "r22/mira", author_name: "Mira", text: "Bridge lanterns are back in place." },
	{ id: "repair-06", ts: 1780283100000, author_id: "r22/eli", author_name: "Eli", text: "We reopened the west footpath too." },
	{ id: "repair-07", ts: 1780283160000, author_id: "r22/jo", author_name: "Jo", text: "The detour signs are down now." },
	{ id: "repair-08", ts: 1780283220000, author_id: "r22/mira", author_name: "Mira", text: "Traffic is moving cleanly through the bridge." },
];

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

async function readJson<T>(path: string): Promise<T> {
	return JSON.parse(await readFile(path, "utf8")) as T;
}

function publicationDate(evidenceDate: string): string {
	return new Date(Date.parse(`${evidenceDate}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
}

function preparedEvidenceForFixture(fixture: EvidenceFixture): PreparedEvidence {
	return prepareEvidence({
		activeRegionId: fixture.active_region_id,
		publicationDate: publicationDate(fixture.evidence_date),
		messages: fixture.messages,
	});
}

function canonicalUtcTimestamp(value: number): string {
	return new Date(value).toISOString();
}

function localCorpusId(corpusPath: string): string {
	return `${corpusPath.replaceAll("/", "-")}-v3`;
}

function expectedLocalCorpusPaths(corpusPath: string, fixtureIds: readonly string[]): string[] {
	return [
		`${corpusPath}/manifest.json`,
		`${corpusPath}/selection.json`,
		...fixtureIds.flatMap((id) => [`${corpusPath}/evidence/${id}.json`, `${corpusPath}/references/${id}.json`]),
	].sort();
}

function localSelectionCase(ordinal: number, id: string, fixture: EvidenceFixture, preparedEvidence: PreparedEvidence): {
	readonly ordinal: number;
	readonly id: string;
	readonly active_region_id: string;
	readonly windows: readonly [{ readonly start_utc: string; readonly end_utc: string }];
	readonly expected_raw_count: number;
	readonly expected_prepared_count: number;
} {
	const timestamps = fixture.messages.map(({ ts }) => ts);
	return {
		ordinal,
		id,
		active_region_id: fixture.active_region_id,
		windows: [{
			start_utc: canonicalUtcTimestamp(Math.min(...timestamps)),
			end_utc: canonicalUtcTimestamp(Math.max(...timestamps) + 1),
		}],
		expected_raw_count: fixture.messages.length,
		expected_prepared_count: preparedEvidence.final_count,
	};
}

function localSparseFixture(fixture: EvidenceFixture): EvidenceFixture {
	return { ...fixture, messages: [...fixture.messages, ...EXTRA_SPARSE_MESSAGES] };
}

function withExpandedSparseWitness<T extends { readonly tag: string; readonly message_ids: readonly string[] }>(witnesses: readonly T[]): T[] {
	return witnesses.map((witness) => witness.tag === "sparse"
		? { ...witness, message_ids: [...witness.message_ids, ...EXTRA_SPARSE_MESSAGES.map(({ id }) => id)] }
		: { ...witness });
}

async function buildLocalCorpus(
	localDataRoot: string,
	corpusPath: string,
): Promise<{
	readonly manifestPath: string;
	readonly manifestReference: Awaited<ReturnType<typeof sourceReferenceForLocalFile>>;
	readonly selectionPath: string;
}> {
	const sourceManifest = EvaluationReferenceManifestSchema.parse(await readJson(join(SOURCE_FIXTURE_ROOT, "manifest.json")));
	const fixtures: Array<{
		readonly ordinal: number;
		readonly id: string;
		readonly evidence: Awaited<ReturnType<typeof sourceReferenceForLocalFile>>;
		readonly reference: Awaited<ReturnType<typeof sourceReferenceForLocalFile>>;
		readonly variation_tags: readonly string[];
		readonly variation_witnesses: readonly { readonly tag: string; readonly reference_ids: readonly string[]; readonly message_ids: readonly string[] }[];
	}> = [];
	const selectionCases: ReturnType<typeof localSelectionCase>[] = [];
	let evidenceDate: string | null = null;
	for (const sourceEntry of sourceManifest.fixtures) {
		const evidencePath = `${corpusPath}/evidence/${sourceEntry.id}.json`;
		const referencePath = `${corpusPath}/references/${sourceEntry.id}.json`;
		const sourceFixture = EvidenceFixtureSchema.parse(await readJson(join(SOURCE_FIXTURE_ROOT, "evidence", `${sourceEntry.id}.json`)));
		const activeRegionId = LOCAL_SELECTION_REGION_IDS[sourceEntry.ordinal - 1];
		assertProof(activeRegionId !== undefined, `Missing active region id for local selection fixture ${sourceEntry.id}`);
		const remappedFixture = { ...sourceFixture, active_region_id: activeRegionId };
		const fixture = sourceEntry.id === SPARSE_FIXTURE_ID ? localSparseFixture(remappedFixture) : remappedFixture;
		if (evidenceDate === null) evidenceDate = fixture.evidence_date;
		const reference = await readJson(join(SOURCE_FIXTURE_ROOT, "references", `${sourceEntry.id}.json`));
		await writeJson(join(localDataRoot, evidencePath), fixture);
		await writeJson(join(localDataRoot, referencePath), reference);
		const preparedEvidence = preparedEvidenceForFixture(fixture);
		selectionCases.push(localSelectionCase(sourceEntry.ordinal, sourceEntry.id, fixture, preparedEvidence));
		fixtures.push({
			ordinal: sourceEntry.ordinal,
			id: sourceEntry.id,
			evidence: await sourceReferenceForLocalFile(localDataRoot, evidencePath),
			reference: await sourceReferenceForLocalFile(localDataRoot, referencePath),
			variation_tags: sourceEntry.variation_tags,
			variation_witnesses: sourceEntry.id === SPARSE_FIXTURE_ID
				? withExpandedSparseWitness(sourceEntry.variation_witnesses)
				: sourceEntry.variation_witnesses.map((witness) => ({ ...witness })),
		});
	}

	const selectionPath = `${corpusPath}/selection.json`;
	const selection = {
		version: 1,
		id: localCorpusId(corpusPath),
		snapshot_sha256: "2".repeat(64),
		evidence_date: evidenceDate ?? "",
		cases: selectionCases,
	};
	await writeJson(join(localDataRoot, selectionPath), selection);
	const manifestPath = `${corpusPath}/manifest.json`;
	await writeJson(join(localDataRoot, manifestPath), {
		version: 3,
		id: selection.id,
		selection: await sourceReferenceForLocalFile(localDataRoot, selectionPath),
		fixtures,
	});
	return { manifestPath, manifestReference: await sourceReferenceForLocalFile(localDataRoot, manifestPath), selectionPath };
}

async function rewriteSelection(
	localDataRoot: string,
	manifestPath: string,
	update: (selection: Record<string, unknown>) => void,
): Promise<void> {
	const manifestAbsolutePath = join(localDataRoot, manifestPath);
	const manifest = EvaluationReferenceManifestV3Schema.parse(await readJson(manifestAbsolutePath));
	const selectionAbsolutePath = join(localDataRoot, manifest.selection.path);
	const selection = await readJson<Record<string, unknown>>(selectionAbsolutePath);
	update(selection);
	await writeJson(selectionAbsolutePath, selection);
	await writeJson(manifestAbsolutePath, {
		...manifest,
		selection: await sourceReferenceForLocalFile(localDataRoot, manifest.selection.path),
	});
}

async function rewriteManifest(
	localDataRoot: string,
	manifestPath: string,
	update: (manifest: Record<string, unknown>) => void,
): Promise<void> {
	const absolutePath = join(localDataRoot, manifestPath);
	const manifest = await readJson<Record<string, unknown>>(absolutePath);
	update(manifest);
	await writeJson(absolutePath, manifest);
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
	const manifest = EvaluationReferenceManifestSchema.parse(await readJson(manifestPath));
	const firstReferencePath = join(repositoryRoot, manifest.fixtures[0]!.reference_path);
	const reference = await readJson<Record<string, unknown>>(firstReferencePath);
	reference.fixture_id = "detached-fixture";
	await writeJson(firstReferencePath, reference);
	await git(repositoryRoot, "add", ".");
	await git(repositoryRoot, "commit", "-m", "Introduce controlled semantic mismatch");
	await expectRejected(() => loadEvaluationReferenceCorpus(manifestPath, repositoryRoot), "Corpus semantic identity mismatch was accepted");
}

async function verifyRepositorySparseRule(repositoryRoot: string, manifestPath: string): Promise<void> {
	const manifest = EvaluationReferenceManifestSchema.parse(await readJson(manifestPath));
	const sparseEvidencePath = join(repositoryRoot, "packages/fixtures/evaluation-corpus/evidence", `${SPARSE_FIXTURE_ID}.json`);
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
	assertProof(Buffer.from(corpus.selectionBytes).equals(await readFile(join(localDataRoot, corpus.selectionPath))), "Local corpus did not expose exact selection bytes");
	assertProof(corpus.selection.id === corpus.manifest.id, "Local corpus did not bind manifest id to selection id");
	assertProof(corpus.entries.every(({ manifestEntry, reference }) => manifestEntry.id === reference.fixture_id), "Local corpus semantic fixture identities are detached");
	assertProof(corpus.manifest.fixtures.every(({ ordinal }, index) => ordinal === index + 1), "Local corpus fixture order is not contiguous");
	assertProof((await listEvaluationLocalSources(localDataRoot, "corpora/primary")).join("|") === expectedLocalCorpusPaths("corpora/primary", corpus.manifest.fixtures.map(({ id }) => id)).join("|"), "Local corpus listing was not deterministic");
	const sparseEntry = corpus.entries.find(({ manifestEntry }) => manifestEntry.id === SPARSE_FIXTURE_ID);
	assertProof(sparseEntry !== undefined && sparseEntry.preparedEvidence.final_count === 8, "Local V3 sparse corpus did not admit the eight-message sparse case");
	assertProof(sparseEntry.manifestEntry.variation_witnesses.find(({ tag }) => tag === "sparse")?.message_ids.length === 8, "Local V3 sparse witness roster was not exact");
	const localCoverage = new Set(corpus.manifest.fixtures.flatMap(({ variation_tags }) => variation_tags));
	assertProof(EVALUATION_CORPUS_VARIATION_TAGS.every((tag) => localCoverage.has(tag)), "Local V3 corpus variation coverage is incomplete");

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
		const { manifestPath } = await initializeControlledEvaluationRepository(repositoryRoot, SOURCE_FIXTURE_ROOT);
		await verifyRepositoryCorpus(repositoryRoot, manifestPath);
		const sparseRule = await initializeControlledEvaluationRepository(repositorySparseRoot, SOURCE_FIXTURE_ROOT);
		await verifyRepositorySparseRule(repositorySparseRoot, sparseRule.manifestPath);
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
