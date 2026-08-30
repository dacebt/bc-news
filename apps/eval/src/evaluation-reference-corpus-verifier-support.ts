import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ACTIVE_REGION_IDS, EvidenceFixtureSchema, type EvidenceFixture } from "@bc-news/contracts";
import type { PreparedEvidence } from "@bc-news/generation-core";
import { EvaluationReferenceManifestV3Schema } from "./evaluation-reference-corpus";
import { controlledReferenceCorpusFixtures } from "./evaluation-reference-corpus-controlled";
import { prepareFixtureEvidenceWithGameReferenceResolutions } from "./fixture-prepared-evidence";
import { sourceReferenceForLocalFile } from "./evaluation-local-source-reference";

const LOCAL_SELECTION_REGION_IDS = ACTIVE_REGION_IDS.slice(0, 12);
const SPARSE_FIXTURE_ID = "sparse-repair-update";
const EXTRA_SPARSE_MESSAGES: EvidenceFixture["messages"] = [
	{ id: "repair-05", ts: 1780283040000, author_id: "r22/mira", author_name: "Mira", text: "Bridge lanterns are back in place." },
	{ id: "repair-06", ts: 1780283100000, author_id: "r22/eli", author_name: "Eli", text: "We reopened the west footpath too." },
	{ id: "repair-07", ts: 1780283160000, author_id: "r22/jo", author_name: "Jo", text: "The detour signs are down now." },
	{ id: "repair-08", ts: 1780283220000, author_id: "r22/mira", author_name: "Mira", text: "Traffic is moving cleanly through the bridge." },
];

export function assertProof(condition: boolean, message: string): asserts condition {
	if (!condition) {
		throw new Error(message);
	}
}

export async function expectRejected(action: () => Promise<unknown>, message: string): Promise<void> {
	let rejected = false;
	try {
		await action();
	} catch {
		rejected = true;
	}
	assertProof(rejected, message);
}

export async function writeJson(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function readJson<T>(path: string): Promise<T> {
	return JSON.parse(await readFile(path, "utf8")) as T;
}

function publicationDate(evidenceDate: string): string {
	return new Date(Date.parse(`${evidenceDate}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
}

function preparedEvidenceForFixture(fixture: EvidenceFixture): PreparedEvidence {
	return prepareFixtureEvidenceWithGameReferenceResolutions({
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

function localSelectionCase(
	ordinal: number,
	id: string,
	fixture: EvidenceFixture,
	preparedEvidence: PreparedEvidence,
): {
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

export function expectedLocalCorpusPaths(corpusPath: string, fixtureIds: readonly string[]): string[] {
	return [
		`${corpusPath}/manifest.json`,
		`${corpusPath}/selection.json`,
		...fixtureIds.flatMap((id) => [`${corpusPath}/evidence/${id}.json`, `${corpusPath}/references/${id}.json`]),
	].sort();
}

export function localSparseFixture(fixture: EvidenceFixture): EvidenceFixture {
	return { ...fixture, messages: [...fixture.messages, ...EXTRA_SPARSE_MESSAGES] };
}

export function withExpandedSparseWitness<T extends { readonly tag: string; readonly message_ids: readonly string[] }>(witnesses: readonly T[]): T[] {
	return witnesses.map((witness) => witness.tag === "sparse"
		? { ...witness, message_ids: [...witness.message_ids, ...EXTRA_SPARSE_MESSAGES.map(({ id }) => id)] }
		: { ...witness });
}

export async function buildLocalCorpus(
	localDataRoot: string,
	corpusPath: string,
): Promise<{
	readonly manifestPath: string;
	readonly manifestReference: Awaited<ReturnType<typeof sourceReferenceForLocalFile>>;
	readonly selectionPath: string;
}> {
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

	for (const sourceEntry of controlledReferenceCorpusFixtures()) {
		const evidencePath = `${corpusPath}/evidence/${sourceEntry.id}.json`;
		const referencePath = `${corpusPath}/references/${sourceEntry.id}.json`;
		const activeRegionId = LOCAL_SELECTION_REGION_IDS[sourceEntry.ordinal - 1];
		assertProof(activeRegionId !== undefined, `Missing active region id for local selection fixture ${sourceEntry.id}`);
		const remappedFixture = EvidenceFixtureSchema.parse({ ...sourceEntry.evidence, active_region_id: activeRegionId });
		const fixture = sourceEntry.id === SPARSE_FIXTURE_ID ? localSparseFixture(remappedFixture) : remappedFixture;
		if (evidenceDate === null) {
			evidenceDate = fixture.evidence_date;
		}
		await writeJson(join(localDataRoot, evidencePath), fixture);
		await writeJson(join(localDataRoot, referencePath), sourceEntry.reference);
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
	const corpusId = localCorpusId(corpusPath);
	await writeJson(join(localDataRoot, selectionPath), {
		version: 1,
		id: corpusId,
		snapshot_sha256: "2".repeat(64),
		evidence_date: evidenceDate ?? "",
		cases: selectionCases,
	});

	const manifestPath = `${corpusPath}/manifest.json`;
	await writeJson(join(localDataRoot, manifestPath), {
		version: 3,
		id: corpusId,
		selection: await sourceReferenceForLocalFile(localDataRoot, selectionPath),
		fixtures,
	});

	return {
		manifestPath,
		manifestReference: await sourceReferenceForLocalFile(localDataRoot, manifestPath),
		selectionPath,
	};
}

export async function rewriteSelection(
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

export async function rewriteManifest(
	localDataRoot: string,
	manifestPath: string,
	update: (manifest: Record<string, unknown>) => void,
): Promise<void> {
	const absolutePath = join(localDataRoot, manifestPath);
	const manifest = await readJson<Record<string, unknown>>(absolutePath);
	update(manifest);
	await writeJson(absolutePath, manifest);
}
