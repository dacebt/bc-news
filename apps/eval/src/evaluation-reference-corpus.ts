import { EvidenceFixtureSchema, type EvidenceFixture } from "@bc-news/contracts";
import { evidenceDateForPublicationDate, prepareEvidence, type PreparedEvidence } from "@bc-news/generation-core";
import { resolve } from "node:path";
import { z } from "zod";
import {
	EvaluationLocalSourceReferenceSchema,
	readEvaluationLocalSource,
	sourceReferenceForLocalFile,
	listEvaluationLocalSources,
	type EvaluationLocalSourceReference,
} from "./evaluation-local-source-reference";
import {
	listRepositorySources,
	readRepositorySource,
	repositorySourceAtLastChange,
	sourceReferenceAtHead,
	type RepositorySourceReference,
} from "./evaluation-repository-reference";

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/u;
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
const VariationWitnessSchema = z.strictObject({
	tag: VariationTagSchema,
	reference_ids: z.array(TrimmedNonblankSchema),
	message_ids: z.array(TrimmedNonblankSchema),
});

export const EvaluationReferenceV1Schema = z.strictObject({
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
export const EvaluationReferenceSchema = EvaluationReferenceV1Schema.omit({ evidence_sha256: true }).extend({ version: z.literal(2) }).strict();

const EvaluationReferenceManifestV1FixtureSchema = z.strictObject({
	ordinal: z.number().int().positive(),
	id: RecordIdSchema,
	evidence_path: TrimmedNonblankSchema,
	evidence_sha256: z.string().regex(SHA256),
	reference_path: TrimmedNonblankSchema,
	reference_sha256: z.string().regex(SHA256),
	variation_tags: z.array(VariationTagSchema).min(1),
	variation_witnesses: z.array(VariationWitnessSchema),
});

export const EvaluationReferenceManifestV1Schema = z.strictObject({
	version: z.literal(1),
	id: RecordIdSchema,
	fixtures: z.array(EvaluationReferenceManifestV1FixtureSchema).min(12),
});

export const EvaluationReferenceManifestSchema = EvaluationReferenceManifestV1Schema.extend({
	version: z.literal(2),
	fixtures: z.array(EvaluationReferenceManifestV1FixtureSchema.omit({
		evidence_sha256: true,
		reference_sha256: true,
	})).min(12),
}).strict();

const EvaluationReferenceManifestV3FixtureSchema = z.strictObject({
	ordinal: z.number().int().positive(),
	id: RecordIdSchema,
	evidence: EvaluationLocalSourceReferenceSchema,
	reference: EvaluationLocalSourceReferenceSchema,
	variation_tags: z.array(VariationTagSchema).min(1),
	variation_witnesses: z.array(VariationWitnessSchema),
});

export const EvaluationReferenceManifestV3Schema = z.strictObject({
	version: z.literal(3),
	id: RecordIdSchema,
	fixtures: z.array(EvaluationReferenceManifestV3FixtureSchema).min(1),
});

export type EvaluationReference = z.infer<typeof EvaluationReferenceSchema>;
export type EvaluationReferenceManifest = z.infer<typeof EvaluationReferenceManifestSchema>;
export type EvaluationReferenceManifestV3 = z.infer<typeof EvaluationReferenceManifestV3Schema>;
export type EvaluationReferenceManifestEntry = EvaluationReferenceManifest["fixtures"][number];
export type EvaluationReferenceManifestV3Entry = EvaluationReferenceManifestV3["fixtures"][number];
type SourceWitness = z.infer<typeof SourceWitnessSchema>;

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

interface LoadedEvaluationReferenceCorpusEntryBase<TManifestEntry> {
	readonly manifestEntry: TManifestEntry;
	readonly evidencePath: string;
	readonly evidenceBytes: Uint8Array;
	readonly fixture: EvidenceFixture;
	readonly publicationDate: string;
	readonly preparedEvidence: PreparedEvidence;
	readonly referencePath: string;
	readonly referenceBytes: Uint8Array;
	readonly reference: EvaluationReference;
}

export type LoadedEvaluationReferenceCorpusEntry = LoadedEvaluationReferenceCorpusEntryBase<EvaluationReferenceManifestEntry>;
export type LoadedLocalEvaluationReferenceCorpusEntry = LoadedEvaluationReferenceCorpusEntryBase<EvaluationReferenceManifestV3Entry>;

export interface LoadedEvaluationReferenceCorpus {
	readonly sourceReference: RepositorySourceReference;
	readonly repositoryRoot: string;
	readonly manifestPath: string;
	readonly manifestBytes: Uint8Array;
	readonly manifest: EvaluationReferenceManifest;
	readonly entries: readonly LoadedEvaluationReferenceCorpusEntry[];
}

export interface LoadedLocalEvaluationReferenceCorpus {
	readonly sourceReference: EvaluationLocalSourceReference;
	readonly localDataRoot: string;
	readonly manifestPath: string;
	readonly manifestBytes: Uint8Array;
	readonly manifest: EvaluationReferenceManifestV3;
	readonly entries: readonly LoadedLocalEvaluationReferenceCorpusEntry[];
}

export type AnyLoadedEvaluationReferenceCorpus = LoadedEvaluationReferenceCorpus | LoadedLocalEvaluationReferenceCorpus;

function fail(code: string, path: string, message: string): never {
	throw new EvaluationReferenceCorpusError(code, path, message);
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
	for (const record of [...reference.ambiguities, ...reference.noteworthy_candidates, ...reference.entities, ...reference.numbers]) {
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

function validateGrounding(entry: LoadedEvaluationReferenceCorpusEntryBase<unknown>): void {
	const raw = new Map(entry.fixture.messages.map((message) => [message.id, message]));
	if (raw.size !== entry.fixture.messages.length) fail("duplicate_message_id", entry.evidencePath, "Raw message ids must be unique");
	const prepared = new Map(entry.preparedEvidence.messages.map((message) => [message.id, message]));
	for (const witness of allRecordWitnesses(entry.reference)) {
		const rawMessage = raw.get(witness.message_id);
		const preparedMessage = prepared.get(witness.message_id);
		if (rawMessage === undefined || preparedMessage === undefined) fail("dangling_witness", entry.referencePath, `Witness message ${witness.message_id} is not retained`);
		const rawValue = rawMessage[witness.field];
		const preparedValue = preparedMessage[witness.field];
		if (rawValue === null || !rawValue.includes(witness.excerpt) || !preparedValue.includes(witness.excerpt)) {
			fail("false_grounding", entry.referencePath, `Witness excerpt is not retained in ${witness.message_id}.${witness.field}`);
		}
	}
	for (const record of entry.reference.entities) {
		if (!record.witnesses.some((witness) => witness.excerpt.includes(record.value))) fail("false_grounding", entry.referencePath, `Entity ${record.id} value is not grounded`);
	}
	for (const record of entry.reference.numbers) {
		if (!record.witnesses.some((witness) => witness.excerpt.includes(record.raw))) fail("false_grounding", entry.referencePath, `Number ${record.id} raw value is not grounded`);
	}
	for (const id of entry.reference.irrelevant_message_ids) {
		if (!raw.has(id) || !prepared.has(id)) fail("dangling_witness", entry.referencePath, `Irrelevant message ${id} is not retained`);
	}
}

function earliestEventTimestamp(reference: EvaluationReference, fixture: EvidenceFixture, eventId: string, path: string): number {
	const event = reference.events.find(({ id }) => id === eventId);
	if (event === undefined) fail("invalid_relationship", path, `Relationship names missing event ${eventId}`);
	const timestamps = statusWitnesses(event).map((witness) => fixture.messages.find(({ id }) => id === witness.message_id)?.ts);
	if (timestamps.some((value) => value === undefined)) fail("invalid_relationship", path, `Event ${eventId} has a dangling witness`);
	return Math.min(...timestamps as number[]);
}

function validateRelationships(entry: LoadedEvaluationReferenceCorpusEntryBase<unknown>): void {
	for (const relationship of entry.reference.event_relationships) {
		unique(relationship.event_ids, entry.referencePath, `${relationship.id} event ids`);
		const timestamps = relationship.event_ids.map((id) => earliestEventTimestamp(entry.reference, entry.fixture, id, entry.referencePath));
		if (relationship.kind === "overlaps") {
			if (timestamps.length < 2 || Math.max(...timestamps) - Math.min(...timestamps) > 15 * 60_000) fail("invalid_relationship", entry.referencePath, `${relationship.id} is not overlapping`);
			continue;
		}
		if (timestamps.length !== 1) fail("invalid_relationship", entry.referencePath, `${relationship.id} must name one event`);
		const otherTimes = entry.reference.events.filter(({ id }) => id !== relationship.event_ids[0]).map(({ id }) => earliestEventTimestamp(entry.reference, entry.fixture, id, entry.referencePath));
		if (otherTimes.some((time) => Math.abs(time - timestamps[0]!) <= 60 * 60_000)) fail("invalid_relationship", entry.referencePath, `${relationship.id} is not isolated`);
	}
}

function qualifiedReference(entry: LoadedEvaluationReferenceCorpusEntryBase<{ variation_tags: readonly string[] }>, value: string): unknown {
	const [kind, id, ...rest] = value.split(":");
	if (kind === undefined || id === undefined || rest.length > 0) return undefined;
	const collections = {
		claim: entry.reference.claims,
		event: entry.reference.events,
		ambiguity: entry.reference.ambiguities,
		noteworthy: entry.reference.noteworthy_candidates,
		entity: entry.reference.entities,
		number: entry.reference.numbers,
		relationship: entry.reference.event_relationships,
	} as const;
	return kind in collections ? collections[kind as keyof typeof collections].find((record) => record.id === id) : undefined;
}

function witnessMessageIds(value: unknown): string[] {
	if (typeof value !== "object" || value === null) return [];
	const record = value as Record<string, unknown>;
	const groups = [record.witnesses, record.supporting_witnesses, record.opposing_witnesses, record.unresolved_witnesses];
	return groups.flatMap((group) => Array.isArray(group) ? group.map((item) => (item as { message_id?: string }).message_id).filter((id): id is string => id !== undefined) : []);
}

function validateVariation(entry: LoadedEvaluationReferenceCorpusEntryBase<{ id: string; variation_tags: readonly EvaluationCorpusVariationTag[]; variation_witnesses: readonly z.infer<typeof VariationWitnessSchema>[] }>): void {
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

function publicationDateForEvidenceDate(evidenceDate: string): string {
	const [year, month, day] = evidenceDate.split("-").map(Number);
	const shifted = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + 1));
	const candidate = `${String(shifted.getUTCFullYear()).padStart(4, "0")}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
	if (evidenceDateForPublicationDate(candidate) !== evidenceDate) fail("identity_mismatch", evidenceDate, "Evidence date does not round-trip to a publication date");
	return candidate;
}

async function loadEntry<TManifestEntry extends { id: string; variation_tags: readonly EvaluationCorpusVariationTag[]; variation_witnesses: readonly z.infer<typeof VariationWitnessSchema>[] }>(
	manifestEntry: TManifestEntry,
	evidencePath: string,
	referencePath: string,
	readBytes: () => Promise<readonly [Uint8Array, Uint8Array]>,
): Promise<LoadedEvaluationReferenceCorpusEntryBase<TManifestEntry>> {
	const [evidenceBytes, referenceBytes] = await readBytes();
	const fixture = parseJson(evidenceBytes, evidencePath, EvidenceFixtureSchema);
	const reference = parseJson(referenceBytes, referencePath, EvaluationReferenceSchema);
	if (reference.fixture_id !== manifestEntry.id) fail("identity_mismatch", referencePath, `Reference identity mismatch for ${manifestEntry.id}`);
	const publicationDate = publicationDateForEvidenceDate(fixture.evidence_date);
	const preparedEvidence = prepareEvidence({ activeRegionId: fixture.active_region_id, publicationDate, messages: fixture.messages });
	const loaded = { manifestEntry, evidencePath, evidenceBytes, fixture, publicationDate, preparedEvidence, referencePath, referenceBytes, reference };
	validateReferenceCollections(reference, referencePath);
	validateGrounding(loaded);
	validateRelationships(loaded);
	validateVariation(loaded);
	return loaded;
}

function localCorpusRoot(manifestPath: string): string {
	if (!manifestPath.endsWith("/manifest.json")) fail("invalid_manifest_location", manifestPath, "Local corpus manifest must end with /manifest.json");
	return manifestPath.slice(0, -"/manifest.json".length);
}

function verifyFixtureRoster<TEntry extends { ordinal: number; id: string }>(entries: readonly TEntry[], path: string): void {
	unique(entries.map(({ id }) => id), path, "fixture ids");
	for (const [index, entry] of entries.entries()) {
		if (entry.ordinal !== index + 1) fail("invalid_order", path, "Fixture ordinals must match manifest positions");
	}
}

function closedRoster(expectedPaths: readonly string[], actualPaths: readonly string[], path: string, message: string): void {
	const expected = [...expectedPaths].sort();
	const actual = [...actualPaths].sort();
	if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) fail("directory_not_closed", path, message);
}

async function loadRepositoryEntry(entry: EvaluationReferenceManifestEntry, repositoryRoot: string, sourceReference: RepositorySourceReference, corpusRoot: string): Promise<LoadedEvaluationReferenceCorpusEntry> {
	const evidencePath = `${corpusRoot}/evidence/${entry.id}.json`;
	const referencePath = `${corpusRoot}/references/${entry.id}.json`;
	if (entry.evidence_path !== evidencePath || entry.reference_path !== referencePath) fail("noncanonical_path", sourceReference.path, `Manifest paths for ${entry.id} are not canonical repository paths`);
	return loadEntry(entry, evidencePath, referencePath, () => Promise.all([
		readRepositorySource(repositoryRoot, { ...sourceReference, path: evidencePath }),
		readRepositorySource(repositoryRoot, { ...sourceReference, path: referencePath }),
	]));
}

async function loadLocalEntry(entry: EvaluationReferenceManifestV3Entry, localDataRoot: string, corpusRoot: string): Promise<LoadedLocalEvaluationReferenceCorpusEntry> {
	const evidencePath = `${corpusRoot}/evidence/${entry.id}.json`;
	const referencePath = `${corpusRoot}/references/${entry.id}.json`;
	if (entry.evidence.path !== evidencePath || entry.reference.path !== referencePath) fail("noncanonical_path", entry.id, `Manifest paths for ${entry.id} are not canonical local corpus paths`);
	return loadEntry(entry, evidencePath, referencePath, () => Promise.all([
		readEvaluationLocalSource(localDataRoot, entry.evidence),
		readEvaluationLocalSource(localDataRoot, entry.reference),
	]));
}

export async function loadEvaluationReferenceCorpusAtReference(repositoryRoot: string, sourceReference: RepositorySourceReference): Promise<LoadedEvaluationReferenceCorpus> {
	const suffix = "/evaluation-corpus/manifest.json";
	if (!sourceReference.path.endsWith(suffix)) fail("invalid_manifest_location", sourceReference.path, `Manifest must end with ${suffix}`);
	const corpusRoot = sourceReference.path.slice(0, -"/manifest.json".length);
	const corpusReference = await repositorySourceAtLastChange(repositoryRoot, sourceReference, corpusRoot);
	const manifestBytes = await readRepositorySource(repositoryRoot, corpusReference);
	const manifest = parseJson(manifestBytes, corpusReference.path, EvaluationReferenceManifestSchema);
	verifyFixtureRoster(manifest.fixtures, corpusReference.path);
	const expectedPaths = manifest.fixtures.flatMap(({ id }) => [`${corpusRoot}/evidence/${id}.json`, `${corpusRoot}/references/${id}.json`]);
	const actualPaths = (await listRepositorySources(repositoryRoot, { ...corpusReference, path: corpusRoot })).filter((path) => path !== corpusReference.path);
	closedRoster(expectedPaths, actualPaths, corpusReference.path, "Committed corpus entries do not exactly match the manifest");
	const entries: LoadedEvaluationReferenceCorpusEntry[] = [];
	for (const entry of manifest.fixtures) entries.push(await loadRepositoryEntry(entry, repositoryRoot, corpusReference, corpusRoot));
	const coverage = new Set(manifest.fixtures.flatMap(({ variation_tags }) => variation_tags));
	if (EVALUATION_CORPUS_VARIATION_TAGS.some((tag) => !coverage.has(tag))) fail("missing_variation_coverage", corpusReference.path, "Manifest does not cover every variation tag");
	return { sourceReference: corpusReference, repositoryRoot, manifestPath: corpusReference.path, manifestBytes, manifest, entries };
}

export async function loadEvaluationReferenceCorpus(manifestPath: string, repositoryRoot: string): Promise<LoadedEvaluationReferenceCorpus> {
	try {
		const sourceReference = await sourceReferenceAtHead(repositoryRoot, manifestPath);
		return await loadEvaluationReferenceCorpusAtReference(repositoryRoot, sourceReference);
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

export async function loadLocalEvaluationReferenceCorpusAtReference(localDataRoot: string, sourceReference: EvaluationLocalSourceReference): Promise<LoadedLocalEvaluationReferenceCorpus> {
	const manifestBytes = await readEvaluationLocalSource(localDataRoot, sourceReference);
	const manifest = parseJson(manifestBytes, sourceReference.path, EvaluationReferenceManifestV3Schema);
	const corpusRoot = localCorpusRoot(sourceReference.path);
	verifyFixtureRoster(manifest.fixtures, sourceReference.path);
	const expectedPaths = [sourceReference.path, ...manifest.fixtures.flatMap(({ id }) => [`${corpusRoot}/evidence/${id}.json`, `${corpusRoot}/references/${id}.json`])];
	const actualPaths = await listEvaluationLocalSources(localDataRoot, corpusRoot);
	closedRoster(expectedPaths, actualPaths, sourceReference.path, "Local corpus entries do not exactly match the manifest");
	const entries: LoadedLocalEvaluationReferenceCorpusEntry[] = [];
	for (const entry of manifest.fixtures) entries.push(await loadLocalEntry(entry, localDataRoot, corpusRoot));
	return { sourceReference, localDataRoot: resolve(localDataRoot), manifestPath: sourceReference.path, manifestBytes, manifest, entries };
}

export async function loadLocalEvaluationReferenceCorpus(localDataRoot: string, manifestPath: string): Promise<LoadedLocalEvaluationReferenceCorpus> {
	try {
		return await loadLocalEvaluationReferenceCorpusAtReference(localDataRoot, await sourceReferenceForLocalFile(localDataRoot, manifestPath));
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
