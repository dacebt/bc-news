import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { EvidenceFixtureSchema, type EvidenceFixture } from "@bc-news/contracts";
import { prepareEvidence, type PreparedEvidence } from "@bc-news/generation-core";
import { z } from "zod";
import { loadFixture } from "./evidence-fixture";

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const TrimmedNonblankSchema = z.string().min(1).refine((value) => value === value.trim(), "String must be trimmed");
const RecordIdSchema = z.string().min(1).regex(KEBAB_CASE).refine((value) => value === value.trim(), "Record id must be trimmed");

export const EVALUATION_CORPUS_VARIATION_TAGS = [
	"dense", "sparse", "overlapping_events", "isolated_event", "contradiction",
	"unresolved_ambiguity", "names", "numbers", "announcement_candidates", "irrelevant_chatter",
] as const;
export type EvaluationCorpusVariationTag = typeof EVALUATION_CORPUS_VARIATION_TAGS[number];
const VariationTagSchema = z.enum(EVALUATION_CORPUS_VARIATION_TAGS);

const SourceWitnessSchema = z.strictObject({
	message_id: TrimmedNonblankSchema,
	field: z.enum(["text", "author_name"]),
	excerpt: TrimmedNonblankSchema,
});
const StatusRecordSchema = z.strictObject({
	id: RecordIdSchema,
	status: z.enum(["established", "contested", "unresolved"]),
	supporting_witnesses: z.array(SourceWitnessSchema),
	opposing_witnesses: z.array(SourceWitnessSchema),
	unresolved_witnesses: z.array(SourceWitnessSchema),
});
const ReferenceSchema = z.strictObject({
	version: z.literal(1),
	fixture_id: RecordIdSchema,
	evidence_sha256: z.string().regex(SHA256),
	claims: z.array(StatusRecordSchema),
	events: z.array(StatusRecordSchema),
	ambiguities: z.array(z.strictObject({ id: RecordIdSchema, witnesses: z.array(SourceWitnessSchema) })),
	noteworthy_candidates: z.array(z.strictObject({
		id: RecordIdSchema,
		kind: z.enum(["event", "request", "milestone", "notice", "background"]),
		witnesses: z.array(SourceWitnessSchema),
	})),
	entities: z.array(z.strictObject({
		id: RecordIdSchema,
		kind: z.enum(["person", "place", "group", "item"]),
		value: TrimmedNonblankSchema,
		witnesses: z.array(SourceWitnessSchema),
	})),
	numbers: z.array(z.strictObject({
		id: RecordIdSchema,
		raw: TrimmedNonblankSchema,
		witnesses: z.array(SourceWitnessSchema),
	})),
	event_relationships: z.array(z.strictObject({
		id: RecordIdSchema,
		kind: z.enum(["overlaps", "isolated"]),
		event_ids: z.array(RecordIdSchema),
	})),
	irrelevant_message_ids: z.array(TrimmedNonblankSchema),
});
const ManifestSchema = z.strictObject({
	version: z.literal(1),
	id: RecordIdSchema,
	fixtures: z.array(z.strictObject({
		ordinal: z.number().int().positive(),
		id: RecordIdSchema,
		evidence_path: TrimmedNonblankSchema,
		evidence_sha256: z.string().regex(SHA256),
		reference_path: TrimmedNonblankSchema,
		reference_sha256: z.string().regex(SHA256),
		variation_tags: z.array(VariationTagSchema).min(1),
		variation_witnesses: z.array(z.strictObject({
			tag: VariationTagSchema,
			reference_ids: z.array(TrimmedNonblankSchema),
			message_ids: z.array(TrimmedNonblankSchema),
		})),
	})).min(12),
});

export type EvaluationReference = z.infer<typeof ReferenceSchema>;
export type EvaluationReferenceManifest = z.infer<typeof ManifestSchema>;
type SourceWitness = z.infer<typeof SourceWitnessSchema>;
type ManifestEntry = EvaluationReferenceManifest["fixtures"][number];

export class EvaluationReferenceCorpusError extends Error {
	readonly code: string;
	readonly path: string;

	constructor(code: string, path: string, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "EvaluationReferenceCorpusError";
		this.code = code;
		this.path = path;
	}
}

export interface LoadedEvaluationReferenceCorpusEntry {
	readonly manifestEntry: ManifestEntry;
	readonly evidencePath: string;
	readonly evidenceBytes: Uint8Array;
	readonly fixture: EvidenceFixture;
	readonly publicationDate: string;
	readonly preparedEvidence: PreparedEvidence;
	readonly referencePath: string;
	readonly referenceBytes: Uint8Array;
	readonly reference: EvaluationReference;
}

export interface LoadedEvaluationReferenceCorpus {
	readonly manifestPath: string;
	readonly manifestBytes: Uint8Array;
	readonly manifestSha256: string;
	readonly manifest: EvaluationReferenceManifest;
	readonly entries: readonly LoadedEvaluationReferenceCorpusEntry[];
}

function fail(code: string, path: string, message: string): never {
	throw new EvaluationReferenceCorpusError(code, path, message);
}

function hash(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function parseJson<T>(bytes: Uint8Array, path: string, schema: z.ZodType<T>): T {
	let candidate: unknown;
	try {
		candidate = JSON.parse(Buffer.from(bytes).toString("utf8"));
	} catch (cause) {
		throw new EvaluationReferenceCorpusError("invalid_json", path, `Invalid JSON at ${path}`, { cause });
	}
	const result = schema.safeParse(candidate);
	if (!result.success) fail("schema_rejected", path, `Contract rejected ${path}: ${result.error.message}`);
	return result.data;
}

function unique(values: readonly string[], path: string, subject: string): void {
	if (new Set(values).size !== values.length) fail("duplicate_value", path, `${subject} contains duplicates`);
}

function inside(root: string, candidate: string): boolean {
	const offset = relative(root, candidate);
	return offset === "" || (!offset.startsWith(`..${sep}`) && offset !== ".." && !isAbsolute(offset));
}

async function assertOwnedPath(path: string, rootReal: string, kind: "file" | "directory"): Promise<void> {
	const info = await lstat(path).catch(() => fail("missing_owned_path", path, `Missing ${kind} ${path}`));
	const actual = await realpath(path).catch(() => fail("invalid_owned_path", path, `${path} must resolve to an owned ${kind}`));
	if (!inside(rootReal, actual)) fail("path_escape", path, `${path} resolves outside the corpus root`);
	if (info.isSymbolicLink() || (kind === "file" ? !info.isFile() : !info.isDirectory())) {
		fail("invalid_owned_path", path, `${path} must be a non-symlink ${kind}`);
	}
}

async function assertDirectoryClosure(directory: string, expected: readonly string[]): Promise<void> {
	const actual = (await readdir(directory)).sort();
	const wanted = [...expected].sort();
	if (actual.length !== wanted.length || actual.some((name, index) => name !== wanted[index])) {
		fail("directory_not_closed", directory, `${directory} entries do not exactly match the manifest`);
	}
}

function witnessKey(witness: SourceWitness): string {
	return JSON.stringify([witness.message_id, witness.field, witness.excerpt]);
}

function allRecordWitnesses(reference: EvaluationReference): SourceWitness[] {
	return [
		...reference.claims.flatMap((record) => [...record.supporting_witnesses, ...record.opposing_witnesses, ...record.unresolved_witnesses]),
		...reference.events.flatMap((record) => [...record.supporting_witnesses, ...record.opposing_witnesses, ...record.unresolved_witnesses]),
		...reference.ambiguities.flatMap((record) => record.witnesses),
		...reference.noteworthy_candidates.flatMap((record) => record.witnesses),
		...reference.entities.flatMap((record) => record.witnesses),
		...reference.numbers.flatMap((record) => record.witnesses),
	];
}

function statusWitnesses(record: EvaluationReference["claims"][number]): SourceWitness[] {
	return [...record.supporting_witnesses, ...record.opposing_witnesses, ...record.unresolved_witnesses];
}

function validateReferenceCollections(reference: EvaluationReference, path: string): void {
	const collections = [reference.claims, reference.events, reference.ambiguities, reference.noteworthy_candidates, reference.entities, reference.numbers, reference.event_relationships];
	for (const collection of collections) unique(collection.map(({ id }) => id), path, "record ids");
	unique(reference.irrelevant_message_ids, path, "irrelevant_message_ids");
	for (const record of [...reference.claims, ...reference.events]) {
		const groups = [record.supporting_witnesses, record.opposing_witnesses, record.unresolved_witnesses];
		for (const group of groups) unique(group.map(witnessKey), path, `${record.id} witnesses`);
		unique(groups.flat().map(witnessKey), path, `${record.id} witnesses across status roles`);
		const valid = record.status === "established"
			? record.supporting_witnesses.length > 0 && record.opposing_witnesses.length === 0 && record.unresolved_witnesses.length === 0
			: record.status === "contested"
				? record.supporting_witnesses.length > 0 && record.opposing_witnesses.length > 0 && record.unresolved_witnesses.length === 0
				: record.unresolved_witnesses.length > 0;
		if (!valid) fail("invalid_status_shape", path, `Record ${record.id} does not match status ${record.status}`);
	}
	for (const record of [...reference.ambiguities, ...reference.noteworthy_candidates]) {
		if (record.witnesses.length === 0) fail("missing_witness", path, `Record ${record.id} requires a witness`);
		unique(record.witnesses.map(witnessKey), path, `${record.id} witnesses`);
	}
	for (const record of [...reference.entities, ...reference.numbers]) {
		if (record.witnesses.length === 0) fail("missing_witness", path, `Record ${record.id} requires a witness`);
		unique(record.witnesses.map(witnessKey), path, `${record.id} witnesses`);
	}
	if ([reference.claims, reference.events, reference.ambiguities, reference.noteworthy_candidates].every((items) => items.length === 0)) {
		fail("empty_reference", path, "A reference must contain a claim, event, ambiguity, or noteworthy candidate");
	}
	const semanticCollections: Array<Array<{ id: string; key: string }>> = [
		reference.claims.map((record) => ({ id: record.id, key: JSON.stringify([record.status, record.supporting_witnesses.map(witnessKey).sort(), record.opposing_witnesses.map(witnessKey).sort(), record.unresolved_witnesses.map(witnessKey).sort()]) })),
		reference.events.map((record) => ({ id: record.id, key: JSON.stringify([record.status, record.supporting_witnesses.map(witnessKey).sort(), record.opposing_witnesses.map(witnessKey).sort(), record.unresolved_witnesses.map(witnessKey).sort()]) })),
		reference.ambiguities.map((record) => ({ id: record.id, key: JSON.stringify(record.witnesses.map(witnessKey).sort()) })),
		reference.noteworthy_candidates.map((record) => ({ id: record.id, key: JSON.stringify([record.kind, record.witnesses.map(witnessKey).sort()]) })),
		reference.entities.map((record) => ({ id: record.id, key: JSON.stringify([record.kind, record.value, record.witnesses.map(witnessKey).sort()]) })),
		reference.numbers.map((record) => ({ id: record.id, key: JSON.stringify([record.raw, record.witnesses.map(witnessKey).sort()]) })),
		reference.event_relationships.map((record) => ({ id: record.id, key: JSON.stringify([record.kind, [...record.event_ids].sort()]) })),
	];
	for (const collection of semanticCollections) unique(collection.map(({ key }) => key), path, "semantic records");
}

function validateGrounding(entry: LoadedEvaluationReferenceCorpusEntry): void {
	const { fixture, preparedEvidence, reference, referencePath } = entry;
	const raw = new Map(fixture.messages.map((message) => [message.id, message]));
	if (raw.size !== fixture.messages.length) fail("duplicate_message_id", entry.evidencePath, "Raw message ids must be unique");
	const prepared = new Map(preparedEvidence.messages.map((message) => [message.id, message]));
	const witnesses = allRecordWitnesses(reference);
	for (const witness of witnesses) {
		const rawMessage = raw.get(witness.message_id);
		const preparedMessage = prepared.get(witness.message_id);
		if (rawMessage === undefined || preparedMessage === undefined) fail("dangling_witness", referencePath, `Witness message ${witness.message_id} is not retained`);
		const rawValue = rawMessage[witness.field];
		const preparedValue = preparedMessage[witness.field];
		if (rawValue === null || !rawValue.includes(witness.excerpt) || !preparedValue.includes(witness.excerpt)) {
			fail("false_grounding", referencePath, `Witness excerpt is not retained in ${witness.message_id}.${witness.field}`);
		}
	}
	for (const record of reference.entities) {
		if (!record.witnesses.some((witness) => witness.excerpt.includes(record.value))) fail("false_grounding", referencePath, `Entity ${record.id} value is not grounded`);
	}
	for (const record of reference.numbers) {
		if (!record.witnesses.some((witness) => witness.excerpt.includes(record.raw))) fail("false_grounding", referencePath, `Number ${record.id} raw value is not grounded`);
	}
	for (const id of reference.irrelevant_message_ids) {
		if (!raw.has(id) || !prepared.has(id)) fail("dangling_witness", referencePath, `Irrelevant message ${id} is not retained`);
	}
}

function earliestEventTimestamp(reference: EvaluationReference, fixture: EvidenceFixture, eventId: string, path: string): number {
	const event = reference.events.find(({ id }) => id === eventId);
	if (event === undefined) fail("invalid_relationship", path, `Relationship names missing event ${eventId}`);
	const timestamps = statusWitnesses(event).map((witness) => fixture.messages.find(({ id }) => id === witness.message_id)?.ts);
	if (timestamps.some((value) => value === undefined)) fail("invalid_relationship", path, `Event ${eventId} has a dangling witness`);
	return Math.min(...timestamps as number[]);
}

function validateRelationships(entry: LoadedEvaluationReferenceCorpusEntry): void {
	const { reference, fixture, referencePath } = entry;
	for (const relationship of reference.event_relationships) {
		unique(relationship.event_ids, referencePath, `${relationship.id} event ids`);
		const timestamps = relationship.event_ids.map((id) => earliestEventTimestamp(reference, fixture, id, referencePath));
		if (relationship.kind === "overlaps") {
			if (timestamps.length < 2 || Math.max(...timestamps) - Math.min(...timestamps) > 15 * 60_000) fail("invalid_relationship", referencePath, `${relationship.id} is not overlapping`);
		} else {
			if (timestamps.length !== 1) fail("invalid_relationship", referencePath, `${relationship.id} must name one event`);
			const otherTimes = reference.events.filter(({ id }) => id !== relationship.event_ids[0]).map(({ id }) => earliestEventTimestamp(reference, fixture, id, referencePath));
			if (otherTimes.some((time) => Math.abs(time - timestamps[0]!) <= 60 * 60_000)) fail("invalid_relationship", referencePath, `${relationship.id} is not isolated`);
		}
	}
}

function qualifiedReference(entry: LoadedEvaluationReferenceCorpusEntry, value: string): unknown {
	const [kind, id, ...rest] = value.split(":");
	if (kind === undefined || rest.length > 0 || id === undefined) return undefined;
	const collections = { claim: entry.reference.claims, event: entry.reference.events, ambiguity: entry.reference.ambiguities, noteworthy: entry.reference.noteworthy_candidates, entity: entry.reference.entities, number: entry.reference.numbers, relationship: entry.reference.event_relationships } as const;
	return kind in collections ? collections[kind as keyof typeof collections].find((record) => record.id === id) : undefined;
}

function witnessMessageIds(value: unknown): string[] {
	if (typeof value !== "object" || value === null) return [];
	const record = value as Record<string, unknown>;
	const groups = [record.witnesses, record.supporting_witnesses, record.opposing_witnesses, record.unresolved_witnesses];
	return groups.flatMap((group) => Array.isArray(group) ? group.map((item) => (item as { message_id?: string }).message_id).filter((id): id is string => id !== undefined) : []);
}

function validateVariation(entry: LoadedEvaluationReferenceCorpusEntry): void {
	const declared = entry.manifestEntry.variation_tags;
	unique(declared, entry.manifestEntry.id, "variation tags");
	if (entry.manifestEntry.variation_witnesses.map(({ tag }) => tag).join("|") !== declared.join("|")) fail("false_variation", entry.manifestEntry.id, "Variation witnesses must match declared tag order");
	const preparedIds = new Set(entry.preparedEvidence.messages.map(({ id }) => id));
	for (const witness of entry.manifestEntry.variation_witnesses) {
		unique(witness.reference_ids, entry.manifestEntry.id, `${witness.tag} reference ids`);
		unique(witness.message_ids, entry.manifestEntry.id, `${witness.tag} message ids`);
		const references = witness.reference_ids.map((id) => qualifiedReference(entry, id));
		if (references.some((record) => record === undefined) || witness.message_ids.some((id) => !preparedIds.has(id))) fail("false_variation", entry.manifestEntry.id, `${witness.tag} has dangling witnesses`);
		const citedIds = new Set(references.flatMap(witnessMessageIds));
		const coversCited = [...citedIds].every((id) => witness.message_ids.includes(id));
		const referenceById = new Map(witness.reference_ids.map((id, index) => [id, references[index]]));
		const relationshipProof = (kind: "overlaps" | "isolated"): boolean => {
			const relationshipPair = [...referenceById].find(([id, record]) => id.startsWith("relationship:") && (record as { kind?: string } | undefined)?.kind === kind);
			if (relationshipPair === undefined) return false;
			const relationship = relationshipPair[1] as EvaluationReference["event_relationships"][number];
			return relationship.event_ids.every((id) => referenceById.has(`event:${id}`))
				&& relationship.event_ids.flatMap((id) => {
					const event = referenceById.get(`event:${id}`) as EvaluationReference["events"][number];
					return statusWitnesses(event).map(({ message_id }) => message_id);
				}).every((id) => witness.message_ids.includes(id));
		};
		const valid = witness.tag === "dense" ? entry.preparedEvidence.final_count >= 24 && witness.message_ids.length >= 24
			: witness.tag === "sparse" ? entry.preparedEvidence.final_count <= 6 && witness.message_ids.length === preparedIds.size && witness.message_ids.every((id) => preparedIds.has(id))
			: witness.tag === "overlapping_events" ? relationshipProof("overlaps") && coversCited
			: witness.tag === "isolated_event" ? relationshipProof("isolated") && coversCited
			: witness.tag === "contradiction" ? references.some((record) => (record as { status?: string }).status === "contested") && coversCited
			: witness.tag === "unresolved_ambiguity" ? [...referenceById].some(([id, record]) => id.startsWith("ambiguity:") || ((id.startsWith("claim:") || id.startsWith("event:")) && (record as { status?: string }).status === "unresolved")) && coversCited
			: witness.tag === "names" ? witness.reference_ids.some((id) => id.startsWith("entity:")) && coversCited
			: witness.tag === "numbers" ? witness.reference_ids.some((id) => id.startsWith("number:")) && coversCited
			: witness.tag === "announcement_candidates" ? [...referenceById].some(([id, record]) => id.startsWith("noteworthy:") && (record as { kind?: string }).kind !== "background") && coversCited
			: witness.message_ids.length > 0 && witness.message_ids.every((id) => entry.reference.irrelevant_message_ids.includes(id));
		if (!valid) fail("false_variation", entry.manifestEntry.id, `${witness.tag} is not objectively witnessed`);
	}
}

async function loadEntry(entry: ManifestEntry, fixturesRoot: string, corpusRoot: string, corpusReal: string): Promise<LoadedEvaluationReferenceCorpusEntry> {
	const evidenceRelative = `evaluation-corpus/evidence/${entry.id}.json`;
	const referenceRelative = `evaluation-corpus/references/${entry.id}.json`;
	if (entry.evidence_path !== evidenceRelative || entry.reference_path !== referenceRelative || isAbsolute(entry.evidence_path) || isAbsolute(entry.reference_path)) fail("noncanonical_path", corpusRoot, `Manifest paths for ${entry.id} are not canonical`);
	const evidencePath = resolve(fixturesRoot, entry.evidence_path);
	const referencePath = resolve(fixturesRoot, entry.reference_path);
	if (!inside(corpusRoot, evidencePath) || !inside(corpusRoot, referencePath)) fail("path_escape", corpusRoot, `Manifest paths for ${entry.id} escape the corpus`);
	await Promise.all([assertOwnedPath(evidencePath, corpusReal, "file"), assertOwnedPath(referencePath, corpusReal, "file")]);
	const [evidenceBytes, referenceBytes] = await Promise.all([readFile(evidencePath), readFile(referencePath)]);
	if (hash(evidenceBytes) !== entry.evidence_sha256 || hash(referenceBytes) !== entry.reference_sha256) fail("hash_mismatch", corpusRoot, `Byte identity mismatch for ${entry.id}`);
	const fixture = parseJson(evidenceBytes, evidencePath, EvidenceFixtureSchema);
	const reference = parseJson(referenceBytes, referencePath, ReferenceSchema);
	if (reference.fixture_id !== entry.id || reference.evidence_sha256 !== entry.evidence_sha256) fail("identity_mismatch", referencePath, `Reference identity mismatch for ${entry.id}`);
	const loadedFixture = await loadFixture(evidencePath);
	const preparedEvidence = prepareEvidence({ activeRegionId: fixture.active_region_id, publicationDate: loadedFixture.publicationDate, messages: fixture.messages });
	const loaded = { manifestEntry: entry, evidencePath, evidenceBytes, fixture, publicationDate: loadedFixture.publicationDate, preparedEvidence, referencePath, referenceBytes, reference };
	validateReferenceCollections(reference, referencePath);
	validateGrounding(loaded);
	validateRelationships(loaded);
	validateVariation(loaded);
	return loaded;
}

async function loadEvaluationReferenceCorpusInternal(manifestPath: string): Promise<LoadedEvaluationReferenceCorpus> {
	const absoluteManifest = resolve(manifestPath);
	const corpusRoot = dirname(absoluteManifest);
	const fixturesRoot = dirname(corpusRoot);
	if (basename(absoluteManifest) !== "manifest.json" || basename(corpusRoot) !== "evaluation-corpus") fail("invalid_manifest_location", absoluteManifest, "Manifest must be <fixtures-root>/evaluation-corpus/manifest.json");
	const corpusInfo = await lstat(corpusRoot).catch(() => fail("missing_owned_path", corpusRoot, `Missing corpus directory ${corpusRoot}`));
	if (!corpusInfo.isDirectory() || corpusInfo.isSymbolicLink()) fail("invalid_owned_path", corpusRoot, "Corpus root must be a non-symlink directory");
	const corpusReal = await realpath(corpusRoot);
	await assertOwnedPath(absoluteManifest, corpusReal, "file");
	const evidenceDirectory = join(corpusRoot, "evidence");
	const referenceDirectory = join(corpusRoot, "references");
	await Promise.all([assertOwnedPath(evidenceDirectory, corpusReal, "directory"), assertOwnedPath(referenceDirectory, corpusReal, "directory")]);
	const manifestBytes = await readFile(absoluteManifest);
	const manifest = parseJson(manifestBytes, absoluteManifest, ManifestSchema);
	unique(manifest.fixtures.map(({ id }) => id), absoluteManifest, "fixture ids");
	for (const [index, entry] of manifest.fixtures.entries()) {
		if (entry.ordinal !== index + 1) fail("invalid_order", absoluteManifest, "Fixture ordinals must match manifest positions");
	}
	await Promise.all([
		assertDirectoryClosure(evidenceDirectory, manifest.fixtures.map(({ id }) => `${id}.json`)),
		assertDirectoryClosure(referenceDirectory, manifest.fixtures.map(({ id }) => `${id}.json`)),
	]);
	const entries: LoadedEvaluationReferenceCorpusEntry[] = [];
	for (const entry of manifest.fixtures) entries.push(await loadEntry(entry, fixturesRoot, corpusRoot, corpusReal));
	const coverage = new Set(manifest.fixtures.flatMap(({ variation_tags }) => variation_tags));
	if (EVALUATION_CORPUS_VARIATION_TAGS.some((tag) => !coverage.has(tag))) fail("missing_variation_coverage", absoluteManifest, "Manifest does not cover every variation tag");
	return { manifestPath: absoluteManifest, manifestBytes, manifestSha256: hash(manifestBytes), manifest, entries };
}

export async function loadEvaluationReferenceCorpus(manifestPath: string): Promise<LoadedEvaluationReferenceCorpus> {
	try {
		return await loadEvaluationReferenceCorpusInternal(manifestPath);
	} catch (error) {
		if (error instanceof EvaluationReferenceCorpusError) throw error;
		throw new EvaluationReferenceCorpusError(
			"corpus_rejected",
			resolve(manifestPath),
			`Evaluation reference corpus rejected: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error },
		);
	}
}
