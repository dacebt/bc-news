import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EvidenceFixtureSchema } from "@bc-news/contracts";
import { parseEvalCliCommand } from "./cli-options";
import {
	EVALUATION_CORPUS_VARIATION_TAGS,
	EvaluationReferenceCorpusError,
	loadEvaluationReferenceCorpus,
} from "./evaluation-reference-corpus";
import { formatEvaluationReferenceCorpusReport } from "./evaluation-reference-corpus-report";
import { loadFixture } from "./evidence-fixture";

type JsonObject = Record<string, unknown>;

function sha(bytes: string | Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function json(value: unknown): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

function message(id: string, minute: number, text: string, authorName = "Rina") {
	return { id, ts: Date.UTC(2026, 7, 9, 0, minute), author_id: `author-${id}`, author_name: authorName, text };
}

function witness(messageId: string, excerpt: string, field: "text" | "author_name" = "text") {
	return { message_id: messageId, field, excerpt };
}

function referenceFixture(fixtureId: string, evidenceSha256: string, rich: boolean): JsonObject {
	const established = { id: "gate-opening", status: "established", supporting_witnesses: [witness("message-01", "gate opens")], opposing_witnesses: [], unresolved_witnesses: [] };
	if (!rich) return {
		version: 1, fixture_id: fixtureId, evidence_sha256: evidenceSha256,
		claims: [established], events: [], ambiguities: [], noteworthy_candidates: [], entities: [], numbers: [], event_relationships: [], irrelevant_message_ids: [],
	};
	return {
		version: 1, fixture_id: fixtureId, evidence_sha256: evidenceSha256,
		claims: [
			established,
			{ id: "attendance-count", status: "contested", supporting_witnesses: [witness("message-02", "42 scouts")], opposing_witnesses: [witness("message-03", "only 39 scouts")], unresolved_witnesses: [] },
		],
		events: [
			{ id: "gate-event", status: "established", supporting_witnesses: [witness("message-01", "gate opens")], opposing_witnesses: [], unresolved_witnesses: [] },
			{ id: "supply-event", status: "established", supporting_witnesses: [witness("message-02", "supplies arrive")], opposing_witnesses: [], unresolved_witnesses: [] },
			{ id: "late-event", status: "established", supporting_witnesses: [witness("message-24", "lantern vigil")], opposing_witnesses: [], unresolved_witnesses: [] },
		],
		ambiguities: [{ id: "meeting-place", witnesses: [witness("message-04", "which eastern gate")] }],
		noteworthy_candidates: [{ id: "opening-notice", kind: "notice", witnesses: [witness("message-01", "gate opens")] }],
		entities: [{ id: "rina-person", kind: "person", value: "Rina", witnesses: [witness("message-01", "Rina", "author_name")] }],
		numbers: [{ id: "scout-number", raw: "42", witnesses: [witness("message-02", "42 scouts")] }],
		event_relationships: [
			{ id: "morning-overlap", kind: "overlaps", event_ids: ["gate-event", "supply-event"] },
			{ id: "late-isolation", kind: "isolated", event_ids: ["late-event"] },
		],
		irrelevant_message_ids: ["message-05"],
	};
}

function richVariationWitnesses() {
	const denseIds = Array.from({ length: 24 }, (_, index) => `message-${String(index + 1).padStart(2, "0")}`);
	return [
		{ tag: "dense", reference_ids: [], message_ids: denseIds },
		{ tag: "overlapping_events", reference_ids: ["relationship:morning-overlap", "event:gate-event", "event:supply-event"], message_ids: ["message-01", "message-02"] },
		{ tag: "isolated_event", reference_ids: ["relationship:late-isolation", "event:late-event"], message_ids: ["message-24"] },
		{ tag: "contradiction", reference_ids: ["claim:attendance-count"], message_ids: ["message-02", "message-03"] },
		{ tag: "unresolved_ambiguity", reference_ids: ["ambiguity:meeting-place"], message_ids: ["message-04"] },
		{ tag: "names", reference_ids: ["entity:rina-person"], message_ids: ["message-01"] },
		{ tag: "numbers", reference_ids: ["number:scout-number"], message_ids: ["message-02"] },
		{ tag: "announcement_candidates", reference_ids: ["noteworthy:opening-notice"], message_ids: ["message-01"] },
		{ tag: "irrelevant_chatter", reference_ids: [], message_ids: ["message-05"] },
	];
}

export async function buildEphemeralEvaluationReferenceCorpus(root: string): Promise<string> {
	const corpusRoot = join(root, "fixtures", "evaluation-corpus");
	const evidenceDirectory = join(corpusRoot, "evidence");
	const referenceDirectory = join(corpusRoot, "references");
	await Promise.all([mkdir(evidenceDirectory, { recursive: true }), mkdir(referenceDirectory, { recursive: true })]);
	const fixtures: JsonObject[] = [];
	for (let index = 0; index < 12; index += 1) {
		const fixtureId = `conversation-${String(index + 1).padStart(2, "0")}`;
		const messages = index === 0
			? Array.from({ length: 24 }, (_, messageIndex) => {
				const id = `message-${String(messageIndex + 1).padStart(2, "0")}`;
				const texts = ["Rina says the gate opens", "42 scouts say supplies arrive", "only 39 scouts arrived", "which eastern gate is unclear", "nice weather chatter"];
				const minute = messageIndex === 1 ? 10 : messageIndex * 60;
				const text = messageIndex === 23 ? "the lantern vigil begins" : texts[messageIndex] ?? `retained detail ${messageIndex + 1}`;
				return message(id, minute, text);
			})
			: [message("message-01", 0, "Rina says the gate opens"), message("message-02", 2, "quiet follow-up")];
		const evidence = json({ active_region_id: "1", evidence_date: "2026-08-09", messages });
		const evidenceSha256 = sha(evidence);
		const reference = json(referenceFixture(fixtureId, evidenceSha256, index === 0));
		await Promise.all([
			writeFile(join(evidenceDirectory, `${fixtureId}.json`), evidence, "utf8"),
			writeFile(join(referenceDirectory, `${fixtureId}.json`), reference, "utf8"),
		]);
		const variationWitnesses = index === 0 ? richVariationWitnesses() : index === 1
			? [{ tag: "sparse", reference_ids: [], message_ids: ["message-01", "message-02"] }]
			: [{ tag: "sparse", reference_ids: [], message_ids: ["message-01", "message-02"] }];
		fixtures.push({
			ordinal: index + 1,
			id: fixtureId,
			evidence_path: `evaluation-corpus/evidence/${fixtureId}.json`, evidence_sha256: evidenceSha256,
			reference_path: `evaluation-corpus/references/${fixtureId}.json`, reference_sha256: sha(reference),
			variation_tags: variationWitnesses.map(({ tag }) => tag), variation_witnesses: variationWitnesses,
		});
	}
	const manifestPath = join(corpusRoot, "manifest.json");
	await writeFile(manifestPath, json({ version: 1, id: "ephemeral-reference-corpus", fixtures }), "utf8");
	return manifestPath;
}

async function expectRejected(operation: () => Promise<unknown>, subject: string, expectedCode: string): Promise<void> {
	try {
		await operation();
	} catch (error) {
		if (error instanceof EvaluationReferenceCorpusError && error.code === expectedCode) return;
		if (error instanceof EvaluationReferenceCorpusError) {
			throw new Error(`Reference corpus mutation ${subject} expected ${expectedCode}, received ${error.code}`, { cause: error });
		}
		throw error;
	}
	throw new Error(`Reference corpus mutation was accepted: ${subject}`);
}

async function readJson(path: string): Promise<JsonObject> {
	return JSON.parse(await readFile(path, "utf8")) as JsonObject;
}

async function mutateCorpus(
	sourceManifest: string,
	root: string,
	expectedCode: string,
	mutate: (manifest: JsonObject, corpusRoot: string) => Promise<void> | void,
): Promise<void> {
	const corpusRoot = join(root, "fixtures", "evaluation-corpus");
	await cp(dirname(sourceManifest), corpusRoot, { recursive: true });
	const manifestPath = join(corpusRoot, "manifest.json");
	const manifest = await readJson(manifestPath);
	await mutate(manifest, corpusRoot);
	await writeFile(manifestPath, json(manifest), "utf8");
	await expectRejected(() => loadEvaluationReferenceCorpus(manifestPath), root, expectedCode);
}

function manifestEntries(manifest: JsonObject): JsonObject[] {
	return manifest.fixtures as JsonObject[];
}

async function changeReference(manifest: JsonObject, corpusRoot: string, index: number, change: (reference: JsonObject) => void): Promise<void> {
	const entry = manifestEntries(manifest)[index]!;
	const path = join(dirname(corpusRoot), entry.reference_path as string);
	const reference = await readJson(path);
	change(reference);
	const bytes = json(reference);
	await writeFile(path, bytes, "utf8");
	entry.reference_sha256 = sha(bytes);
}

async function changeEvidenceAndReference(
	manifest: JsonObject,
	corpusRoot: string,
	index: number,
	change: (evidence: JsonObject, reference: JsonObject) => void,
): Promise<void> {
	const entry = manifestEntries(manifest)[index]!;
	const fixturesRoot = dirname(corpusRoot);
	const evidencePath = join(fixturesRoot, entry.evidence_path as string);
	const referencePath = join(fixturesRoot, entry.reference_path as string);
	const [evidence, reference] = await Promise.all([readJson(evidencePath), readJson(referencePath)]);
	change(evidence, reference);
	const evidenceBytes = json(evidence);
	entry.evidence_sha256 = sha(evidenceBytes);
	reference.evidence_sha256 = entry.evidence_sha256;
	const referenceBytes = json(reference);
	entry.reference_sha256 = sha(referenceBytes);
	await Promise.all([writeFile(evidencePath, evidenceBytes, "utf8"), writeFile(referencePath, referenceBytes, "utf8")]);
}

async function runMutationProofs(sourceManifest: string, root: string): Promise<void> {
	let ordinal = 0;
	const nextRoot = () => join(root, `mutation-${String(++ordinal).padStart(2, "0")}`);
	await mutateCorpus(sourceManifest, nextRoot(), "duplicate_value", (manifest, corpusRoot) => changeReference(manifest, corpusRoot, 0, (reference) => {
		const claims = reference.claims as JsonObject[];
		claims.push({ id: claims[0]!.id, status: "unresolved", supporting_witnesses: [], opposing_witnesses: [], unresolved_witnesses: [witness("message-04", "which eastern gate")] });
	}));
	await mutateCorpus(sourceManifest, nextRoot(), "invalid_order", (manifest) => { const entries = manifestEntries(manifest); [entries[0], entries[1]] = [entries[1]!, entries[0]!]; });
	await mutateCorpus(sourceManifest, nextRoot(), "noncanonical_path", (manifest) => { manifestEntries(manifest)[0]!.evidence_path = "../escape.json"; });
	await mutateCorpus(sourceManifest, nextRoot(), "path_escape", async (manifest, corpusRoot) => {
		const entry = manifestEntries(manifest)[0]!;
		const evidencePath = join(dirname(corpusRoot), entry.evidence_path as string);
		const escapedPath = join(dirname(corpusRoot), "escaped-evidence.json");
		await writeFile(escapedPath, await readFile(evidencePath));
		await rm(evidencePath);
		await symlink(escapedPath, evidencePath);
	});
	await mutateCorpus(sourceManifest, nextRoot(), "hash_mismatch", (manifest) => { manifestEntries(manifest)[0]!.evidence_sha256 = "0".repeat(64); });
	await mutateCorpus(sourceManifest, nextRoot(), "duplicate_value", (manifest, corpusRoot) => changeReference(manifest, corpusRoot, 0, (reference) => {
		const claims = reference.claims as JsonObject[];
		claims.push({ ...structuredClone(claims[0]!), id: "semantic-copy" });
	}));
	await mutateCorpus(sourceManifest, nextRoot(), "duplicate_value", (manifest, corpusRoot) => changeReference(manifest, corpusRoot, 0, (reference) => {
		const claim = (reference.claims as JsonObject[])[1]!;
		const reusedWitness = structuredClone((claim.supporting_witnesses as JsonObject[])[0]!);
		(claim.opposing_witnesses as JsonObject[]).push(reusedWitness);
	}));
	await mutateCorpus(sourceManifest, nextRoot(), "dangling_witness", (manifest, corpusRoot) => changeReference(manifest, corpusRoot, 0, (reference) => {
		((reference.claims as JsonObject[])[0]!.supporting_witnesses as JsonObject[])[0]!.message_id = "missing-message";
	}));
	await mutateCorpus(sourceManifest, nextRoot(), "dangling_witness", (manifest, corpusRoot) => changeEvidenceAndReference(manifest, corpusRoot, 0, (evidence, reference) => {
		(evidence.messages as JsonObject[]).push(message("filtered-message", 30, "x"));
		(reference.claims as JsonObject[]).push({ id: "filtered-claim", status: "established", supporting_witnesses: [witness("filtered-message", "x")], opposing_witnesses: [], unresolved_witnesses: [] });
	}));
	await mutateCorpus(sourceManifest, nextRoot(), "dangling_witness", (manifest, corpusRoot) => changeEvidenceAndReference(manifest, corpusRoot, 0, (evidence, reference) => {
		const first = { ...message("merge-parent", 40, "merge parent text"), author_id: "merge-author" };
		const second = { ...message("merge-child", 40, "merge child text"), ts: first.ts + 15_000, author_id: "merge-author" };
		(evidence.messages as JsonObject[]).push(first, second);
		(reference.claims as JsonObject[]).push({ id: "merged-claim", status: "established", supporting_witnesses: [witness("merge-child", "merge child text")], opposing_witnesses: [], unresolved_witnesses: [] });
	}));
	await mutateCorpus(sourceManifest, nextRoot(), "false_grounding", (manifest, corpusRoot) => changeReference(manifest, corpusRoot, 0, (reference) => {
		((reference.claims as JsonObject[])[0]!.supporting_witnesses as JsonObject[])[0]!.excerpt = "not in source";
	}));
	await mutateCorpus(sourceManifest, nextRoot(), "false_grounding", (manifest, corpusRoot) => changeReference(manifest, corpusRoot, 0, (reference) => {
		(reference.entities as JsonObject[])[0]!.value = "Absent Person";
	}));
	await mutateCorpus(sourceManifest, nextRoot(), "false_grounding", (manifest, corpusRoot) => changeReference(manifest, corpusRoot, 0, (reference) => {
		(reference.numbers as JsonObject[])[0]!.raw = "999";
	}));
	await mutateCorpus(sourceManifest, nextRoot(), "invalid_status_shape", (manifest, corpusRoot) => changeReference(manifest, corpusRoot, 0, (reference) => {
		(reference.claims as JsonObject[])[0]!.opposing_witnesses = [witness("message-02", "42 scouts")];
	}));
	await mutateCorpus(sourceManifest, nextRoot(), "invalid_relationship", (manifest, corpusRoot) => changeReference(manifest, corpusRoot, 0, (reference) => {
		(reference.event_relationships as JsonObject[])[0]!.event_ids = ["gate-event"];
	}));
	await mutateCorpus(sourceManifest, nextRoot(), "schema_rejected", (manifest, corpusRoot) => changeReference(manifest, corpusRoot, 0, (reference) => { reference.article = "forbidden"; }));
	await mutateCorpus(sourceManifest, nextRoot(), "directory_not_closed", async (_manifest, corpusRoot) => { await writeFile(join(corpusRoot, "evidence", "unlisted.json"), "{}\n", "utf8"); });
	await mutateCorpus(sourceManifest, nextRoot(), "directory_not_closed", async (_manifest, corpusRoot) => { await writeFile(join(corpusRoot, "references", "unlisted.json"), "{}\n", "utf8"); });
	await mutateCorpus(sourceManifest, nextRoot(), "missing_variation_coverage", (manifest) => {
		for (const entry of manifestEntries(manifest)) {
			const tags = entry.variation_tags as string[];
			const witnesses = entry.variation_witnesses as JsonObject[];
			const index = tags.indexOf("numbers");
			if (index >= 0) { tags.splice(index, 1); witnesses.splice(index, 1); }
		}
	});
	await mutateCorpus(sourceManifest, nextRoot(), "false_variation", (manifest) => {
		const witnessEntry = (manifestEntries(manifest)[0]!.variation_witnesses as JsonObject[]).find(({ tag }) => tag === "names")!;
		witnessEntry.reference_ids = ["entity:missing"];
	});
}

function proveCliBoundary(): void {
	const legacy = [
		["benchmark", "run", "--fixture", "fixture.json", "--config", "models.json"],
		["acceptance", "run", "--fixture", "fixture.json"],
		["fixture", "record-responses", "--fixture", "fixture.json", "--config", "models.json"],
		["context", "benchmark", "--fixture", "fixture.json"],
	] as const;
	for (const argv of legacy) {
		parseEvalCliCommand(argv);
		try {
			parseEvalCliCommand([...argv, "--corpus", "manifest.json"]);
			throw new Error(`Existing namespace accepted --corpus: ${argv.join(" ")}`);
		} catch (error) {
			if (!(error instanceof Error) || !error.message.includes("--corpus is not valid")) throw error;
		}
	}
	const corpus = parseEvalCliCommand(["corpus", "show", "--corpus", "manifest.json"]);
	if (corpus.command !== "corpus-show") throw new Error("Corpus show route did not parse");
}

export async function verifyEvaluationReferenceCorpus(manifestPath: string): Promise<string> {
	const corpus = await loadEvaluationReferenceCorpus(manifestPath);
	if (corpus.entries.length < 12) throw new Error("Reference corpus has fewer than twelve fixtures");
	const coverage = new Set(corpus.manifest.fixtures.flatMap(({ variation_tags }) => variation_tags));
	if (EVALUATION_CORPUS_VARIATION_TAGS.some((tag) => !coverage.has(tag))) throw new Error("Reference corpus variation coverage is incomplete");
	for (const entry of corpus.entries) EvidenceFixtureSchema.parse(JSON.parse(Buffer.from(entry.evidenceBytes).toString("utf8")) as unknown);
	const report = formatEvaluationReferenceCorpusReport(corpus);
	const root = await mkdtemp(join(tmpdir(), "bc-news-reference-corpus-proof-"));
	try {
		const proofManifest = await buildEphemeralEvaluationReferenceCorpus(join(root, "source"));
		await runMutationProofs(proofManifest, root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
	proveCliBoundary();
	const sourceDirectory = dirname(fileURLToPath(import.meta.url));
	const fixturesDirectory = resolve(sourceDirectory, "../../../packages/fixtures");
	const [legacyFixture, canonicalLegacyFixture] = await Promise.all([
		loadFixture(fixturesDirectory),
		loadFixture(join(fixturesDirectory, "evidence", "active-region-7_2026-01-24.json")),
	]);
	if (legacyFixture.fixtureSha256 !== canonicalLegacyFixture.fixtureSha256) throw new Error("Legacy package-directory fixture selection changed");
	return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const manifestPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/fixtures/evaluation-corpus/manifest.json");
	verifyEvaluationReferenceCorpus(manifestPath).then(() => {
		console.log("EVALUATION REFERENCE CORPUS VERIFIED");
	}).catch((error: unknown) => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}
