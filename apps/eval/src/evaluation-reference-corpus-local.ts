import { resolve } from "node:path";
import { z } from "zod";
import type { EvidenceFixture } from "@bc-news/contracts";
import type { PreparedEvidence } from "@bc-news/generation-core";
import {
	ProductionCorpusSelectionSchema,
	type ProductionCorpusSelection,
} from "./evaluation-corpus-selection";
import {
	EvaluationLocalSourceReferenceSchema,
	listEvaluationLocalSources,
	readEvaluationLocalSource,
	sourceReferenceForLocalFile,
	type EvaluationLocalSourceReference,
} from "./evaluation-local-source-reference";
import type {
	EvaluationCorpusVariationTag,
	EvaluationReference,
} from "./evaluation-reference-corpus";

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TrimmedNonblankSchema = z.string().min(1).refine((value) => value === value.trim(), "String must be trimmed");
const RecordIdSchema = z.string().min(1).regex(KEBAB_CASE).refine((value) => value === value.trim(), "Record id must be trimmed");

const VariationTagSchema = z.enum([
	"dense",
	"sparse",
	"overlapping_events",
	"isolated_event",
	"contradiction",
	"unresolved_ambiguity",
	"names",
	"numbers",
	"announcement_candidates",
	"irrelevant_chatter",
]);

const VariationWitnessSchema = z.strictObject({
	tag: VariationTagSchema,
	reference_ids: z.array(TrimmedNonblankSchema),
	message_ids: z.array(TrimmedNonblankSchema),
});

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
	selection: EvaluationLocalSourceReferenceSchema,
	fixtures: z.array(EvaluationReferenceManifestV3FixtureSchema).min(1),
});

export type EvaluationReferenceManifestV3 = z.infer<typeof EvaluationReferenceManifestV3Schema>;
export type EvaluationReferenceManifestV3Entry = EvaluationReferenceManifestV3["fixtures"][number];

export interface LoadedLocalEvaluationReferenceCorpusEntry {
	readonly manifestEntry: EvaluationReferenceManifestV3Entry;
	readonly evidencePath: string;
	readonly evidenceBytes: Uint8Array;
	readonly fixture: EvidenceFixture;
	readonly publicationDate: string;
	readonly preparedEvidence: PreparedEvidence;
	readonly referencePath: string;
	readonly referenceBytes: Uint8Array;
	readonly reference: EvaluationReference;
}

export interface LoadedLocalEvaluationReferenceCorpus {
	readonly sourceReference: EvaluationLocalSourceReference;
	readonly localDataRoot: string;
	readonly manifestPath: string;
	readonly manifestBytes: Uint8Array;
	readonly manifest: EvaluationReferenceManifestV3;
	readonly selectionPath: string;
	readonly selectionBytes: Uint8Array;
	readonly selection: ProductionCorpusSelection;
	readonly entries: readonly LoadedLocalEvaluationReferenceCorpusEntry[];
}

interface LocalCorpusLoaderTools {
	readonly closeRoster: (expectedPaths: readonly string[], actualPaths: readonly string[], path: string, message: string) => void;
	readonly fail: (code: string, path: string, message: string) => never;
	readonly loadLocalEntry: (
		entry: EvaluationReferenceManifestV3Entry,
		localDataRoot: string,
		corpusRoot: string,
	) => Promise<LoadedLocalEvaluationReferenceCorpusEntry>;
	readonly parseJson: <T>(bytes: Uint8Array, path: string, schema: z.ZodType<T>) => T;
	readonly verifyFixtureRoster: <TEntry extends { ordinal: number; id: string }>(entries: readonly TEntry[], path: string) => void;
}

function localCorpusRoot(manifestPath: string, fail: LocalCorpusLoaderTools["fail"]): string {
	if (!manifestPath.endsWith("/manifest.json")) fail("invalid_manifest_location", manifestPath, "Local corpus manifest must end with /manifest.json");
	return manifestPath.slice(0, -"/manifest.json".length);
}

function timestampWithinSelectionWindows(
	timestamp: number,
	windows: readonly ProductionCorpusSelection["cases"][number]["windows"][number][],
): boolean {
	return windows.some((window) => {
		const start = Date.parse(window.start_utc);
		const end = Date.parse(window.end_utc);
		return timestamp >= start && timestamp < end;
	});
}

function validateLocalSelectionBinding(
	manifest: EvaluationReferenceManifestV3,
	selection: ProductionCorpusSelection,
	entries: readonly LoadedLocalEvaluationReferenceCorpusEntry[],
	path: string,
	fail: LocalCorpusLoaderTools["fail"],
): void {
	if (manifest.id !== selection.id) fail("identity_mismatch", path, "Local corpus manifest id must match selection id");
	if (manifest.fixtures.length !== selection.cases.length) fail("identity_mismatch", path, "Local corpus fixture roster must match selection cases");
	for (const [index, entry] of entries.entries()) {
		const selected = selection.cases[index];
		if (selected === undefined) fail("identity_mismatch", path, "Selection case is missing");
		if (entry.manifestEntry.ordinal !== selected.ordinal || entry.manifestEntry.id !== selected.id) {
			fail("identity_mismatch", path, `Selection case order does not match fixture ${entry.manifestEntry.id}`);
		}
		if (entry.fixture.active_region_id !== selected.active_region_id) {
			fail("identity_mismatch", path, `Selection region does not match fixture ${entry.manifestEntry.id}`);
		}
		if (entry.fixture.evidence_date !== selection.evidence_date) {
			fail("identity_mismatch", path, `Selection evidence date does not match fixture ${entry.manifestEntry.id}`);
		}
		if (entry.fixture.messages.length !== selected.expected_raw_count) {
			fail("identity_mismatch", path, `Selection raw count does not match fixture ${entry.manifestEntry.id}`);
		}
		if (entry.preparedEvidence.final_count !== selected.expected_prepared_count) {
			fail("identity_mismatch", path, `Selection prepared count does not match fixture ${entry.manifestEntry.id}`);
		}
		if (entry.fixture.messages.some(({ ts }) => !timestampWithinSelectionWindows(ts, selected.windows))) {
			fail("identity_mismatch", path, `Selection windows do not cover fixture ${entry.manifestEntry.id}`);
		}
	}
}

export async function loadLocalEvaluationReferenceCorpusAtReference(
	localDataRoot: string,
	sourceReference: EvaluationLocalSourceReference,
	tools: LocalCorpusLoaderTools,
): Promise<LoadedLocalEvaluationReferenceCorpus> {
	const manifestBytes = await readEvaluationLocalSource(localDataRoot, sourceReference);
	const manifest = tools.parseJson(manifestBytes, sourceReference.path, EvaluationReferenceManifestV3Schema);
	const corpusRoot = localCorpusRoot(sourceReference.path, tools.fail);
	const selectionPath = `${corpusRoot}/selection.json`;
	if (manifest.selection.path !== selectionPath) {
		tools.fail("noncanonical_path", sourceReference.path, "Local corpus selection must use the canonical selection.json path");
	}
	const selectionBytes = await readEvaluationLocalSource(localDataRoot, manifest.selection);
	const selection = tools.parseJson(selectionBytes, manifest.selection.path, ProductionCorpusSelectionSchema);
	tools.verifyFixtureRoster(manifest.fixtures, sourceReference.path);
	const expectedPaths = [
		sourceReference.path,
		selectionPath,
		...manifest.fixtures.flatMap(({ id }) => [`${corpusRoot}/evidence/${id}.json`, `${corpusRoot}/references/${id}.json`]),
	];
	const actualPaths = await listEvaluationLocalSources(localDataRoot, corpusRoot);
	tools.closeRoster(expectedPaths, actualPaths, sourceReference.path, "Local corpus entries do not exactly match the manifest");
	const entries: LoadedLocalEvaluationReferenceCorpusEntry[] = [];
	for (const entry of manifest.fixtures) {
		entries.push(await tools.loadLocalEntry(entry, localDataRoot, corpusRoot));
	}
	validateLocalSelectionBinding(manifest, selection, entries, sourceReference.path, tools.fail);
	const coverage = new Set(manifest.fixtures.flatMap(({ variation_tags }) => variation_tags));
	for (const tag of VariationTagSchema.options as readonly EvaluationCorpusVariationTag[]) {
		if (!coverage.has(tag)) {
			tools.fail("missing_variation_coverage", sourceReference.path, "Local corpus manifest does not cover every variation tag");
		}
	}
	return {
		sourceReference,
		localDataRoot: resolve(localDataRoot),
		manifestPath: sourceReference.path,
		manifestBytes,
		manifest,
		selectionPath,
		selectionBytes,
		selection,
		entries,
	};
}

export async function sourceReferenceForLocalManifest(
	localDataRoot: string,
	manifestPath: string,
): Promise<EvaluationLocalSourceReference> {
	return sourceReferenceForLocalFile(localDataRoot, manifestPath);
}
