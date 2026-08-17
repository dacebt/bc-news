import { EvidenceFixtureSchema, type EvidenceFixture } from "@bc-news/contracts";
import { prepareEvidence, type PreparedEvidence } from "@bc-news/generation-core";
import { resolve } from "node:path";
import { z } from "zod";
import { type EvaluationLocalSourceReference, readEvaluationLocalSource } from "./evaluation-local-source-reference";
import { listRepositorySources, readRepositorySource, repositorySourceAtLastChange, sourceReferenceAtHead, type RepositorySourceReference } from "./evaluation-repository-reference";
import {
	loadLocalEvaluationReferenceCorpusAtReference as loadLocalEvaluationReferenceCorpusAtReferenceInternal,
	sourceReferenceForLocalManifest,
	type EvaluationReferenceManifestV3Entry,
	type LoadedLocalEvaluationReferenceCorpus,
	type LoadedLocalEvaluationReferenceCorpusEntry,
} from "./evaluation-reference-corpus-local";
import { validateReferenceRules } from "./evaluation-reference-corpus-rules";
import { closedRoster, publicationDateForEvidenceDate, verifyFixtureRoster } from "./evaluation-reference-corpus-utils";
export {
	EvaluationReferenceManifestV3Schema,
} from "./evaluation-reference-corpus-local";
export type {
	EvaluationReferenceManifestV3,
	EvaluationReferenceManifestV3Entry,
	LoadedLocalEvaluationReferenceCorpus,
	LoadedLocalEvaluationReferenceCorpusEntry,
} from "./evaluation-reference-corpus-local";

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

export type EvaluationReference = z.infer<typeof EvaluationReferenceSchema>;
export type EvaluationReferenceManifest = z.infer<typeof EvaluationReferenceManifestSchema>;
export type EvaluationReferenceManifestEntry = EvaluationReferenceManifest["fixtures"][number];
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

export interface LoadedEvaluationReferenceCorpus {
	readonly sourceReference: RepositorySourceReference;
	readonly repositoryRoot: string;
	readonly manifestPath: string;
	readonly manifestBytes: Uint8Array;
	readonly manifest: EvaluationReferenceManifest;
	readonly entries: readonly LoadedEvaluationReferenceCorpusEntry[];
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

async function loadEntry<TManifestEntry extends { id: string; variation_tags: readonly EvaluationCorpusVariationTag[]; variation_witnesses: readonly z.infer<typeof VariationWitnessSchema>[] }>(
	manifestEntry: TManifestEntry,
	evidencePath: string,
	referencePath: string,
	readBytes: () => Promise<readonly [Uint8Array, Uint8Array]>,
	sparseMaximum: number,
): Promise<LoadedEvaluationReferenceCorpusEntryBase<TManifestEntry>> {
	const [evidenceBytes, referenceBytes] = await readBytes();
	const fixture = parseJson(evidenceBytes, evidencePath, EvidenceFixtureSchema);
	const reference = parseJson(referenceBytes, referencePath, EvaluationReferenceSchema);
	if (reference.fixture_id !== manifestEntry.id) fail("identity_mismatch", referencePath, `Reference identity mismatch for ${manifestEntry.id}`);
	const publicationDate = publicationDateForEvidenceDate(fixture.evidence_date, fail);
	const preparedEvidence = prepareEvidence({ activeRegionId: fixture.active_region_id, publicationDate, messages: fixture.messages });
	const loaded = { manifestEntry, evidencePath, evidenceBytes, fixture, publicationDate, preparedEvidence, referencePath, referenceBytes, reference };
	validateReferenceCollections(reference, referencePath);
	validateGrounding(loaded);
	validateReferenceRules(loaded, sparseMaximum, { fail, statusWitnesses, unique });
	return loaded;
}

async function loadRepositoryEntry(entry: EvaluationReferenceManifestEntry, repositoryRoot: string, sourceReference: RepositorySourceReference, corpusRoot: string): Promise<LoadedEvaluationReferenceCorpusEntry> {
	const evidencePath = `${corpusRoot}/evidence/${entry.id}.json`;
	const referencePath = `${corpusRoot}/references/${entry.id}.json`;
	if (entry.evidence_path !== evidencePath || entry.reference_path !== referencePath) fail("noncanonical_path", sourceReference.path, `Manifest paths for ${entry.id} are not canonical repository paths`);
	return loadEntry(entry, evidencePath, referencePath, () => Promise.all([
		readRepositorySource(repositoryRoot, { ...sourceReference, path: evidencePath }),
		readRepositorySource(repositoryRoot, { ...sourceReference, path: referencePath }),
	]), 6);
}

async function loadLocalEntry(entry: EvaluationReferenceManifestV3Entry, localDataRoot: string, corpusRoot: string): Promise<LoadedLocalEvaluationReferenceCorpusEntry> {
	const evidencePath = `${corpusRoot}/evidence/${entry.id}.json`;
	const referencePath = `${corpusRoot}/references/${entry.id}.json`;
	if (entry.evidence.path !== evidencePath || entry.reference.path !== referencePath) fail("noncanonical_path", entry.id, `Manifest paths for ${entry.id} are not canonical local corpus paths`);
	return loadEntry(entry, evidencePath, referencePath, () => Promise.all([
		readEvaluationLocalSource(localDataRoot, entry.evidence),
		readEvaluationLocalSource(localDataRoot, entry.reference),
	]), 13);
}

export async function loadEvaluationReferenceCorpusAtReference(repositoryRoot: string, sourceReference: RepositorySourceReference): Promise<LoadedEvaluationReferenceCorpus> {
	const suffix = "/evaluation-corpus/manifest.json";
	if (!sourceReference.path.endsWith(suffix)) fail("invalid_manifest_location", sourceReference.path, `Manifest must end with ${suffix}`);
	const corpusRoot = sourceReference.path.slice(0, -"/manifest.json".length);
	const corpusReference = await repositorySourceAtLastChange(repositoryRoot, sourceReference, corpusRoot);
	const manifestBytes = await readRepositorySource(repositoryRoot, corpusReference);
	const manifest = parseJson(manifestBytes, corpusReference.path, EvaluationReferenceManifestSchema);
	verifyFixtureRoster(manifest.fixtures, corpusReference.path, unique, fail);
	const expectedPaths = manifest.fixtures.flatMap(({ id }) => [`${corpusRoot}/evidence/${id}.json`, `${corpusRoot}/references/${id}.json`]);
	const actualPaths = (await listRepositorySources(repositoryRoot, { ...corpusReference, path: corpusRoot })).filter((path) => path !== corpusReference.path);
	closedRoster(expectedPaths, actualPaths, corpusReference.path, "Committed corpus entries do not exactly match the manifest", fail);
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
	return loadLocalEvaluationReferenceCorpusAtReferenceInternal(localDataRoot, sourceReference, {
		closeRoster: (expectedPaths, actualPaths, path, message) => closedRoster(expectedPaths, actualPaths, path, message, fail),
		fail,
		loadLocalEntry,
		parseJson,
		verifyFixtureRoster: (entries, path) => verifyFixtureRoster(entries, path, unique, fail),
	});
}

export async function loadLocalEvaluationReferenceCorpus(localDataRoot: string, manifestPath: string): Promise<LoadedLocalEvaluationReferenceCorpus> {
	try {
		return await loadLocalEvaluationReferenceCorpusAtReference(localDataRoot, await sourceReferenceForLocalManifest(localDataRoot, manifestPath));
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
