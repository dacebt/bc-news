import { EvidenceFixtureSchema } from "@bc-news/contracts";
import { evidenceDateForPublicationDate, prepareEvidence } from "@bc-news/generation-core";
import { z } from "zod";
import {
	EvaluationReferenceManifestSchema,
	EvaluationReferenceSchema,
} from "./evaluation-reference-corpus";
import {
	EvaluationLocalSourceError,
	sourceReferenceForLocalFile,
	readEvaluationLocalSource,
	listEvaluationLocalSources,
	type EvaluationLocalSourceReference,
} from "./evaluation-local-source-reference";
import {
	parseEvaluationScorecardBenchmark,
	type ScorecardBenchmarkRun,
} from "./evaluation-scorecard-input-v2";
import {
	validateLoadedEvaluationScorecardInput,
	type LoadedEvaluationReferenceCorpus,
	type LoadedEvaluationReferenceCorpusEntry,
	type LoadedEvaluationScorecardInput,
	type LoadedScorecardRun,
} from "./evaluation-scorecard-input-validation";
import {
	AnnotationBundleSchema,
	EvaluationScorecardDeclarationSchema,
	EvaluationScorecardError,
	QualitativeReviewBundleSchema,
} from "./evaluation-scorecard";

type ManifestEntry = LoadedEvaluationReferenceCorpus["manifest"]["fixtures"][number];

export type { ScorecardBenchmarkRun };
export { validateLoadedEvaluationScorecardInput };
export type { LoadedEvaluationScorecardInput, LoadedScorecardRun } from "./evaluation-scorecard-input-validation";
export type { SelectedScorecardOutput } from "./evaluation-scorecard-input-validation";

function fail(code: EvaluationScorecardError["code"], path: string, message: string, cause?: unknown): never {
	throw new EvaluationScorecardError(code, path, message, cause === undefined ? undefined : { cause });
}
function sourcePath(reference: EvaluationLocalSourceReference): string { return reference.path; }
function json(raw: Uint8Array, path: string, code: "invalid_declaration_json" | "benchmark_artifact_malformed" | "annotation_bundle_rejected" | "review_bundle_rejected"): unknown {
	try { return JSON.parse(Buffer.from(raw).toString("utf8")) as unknown; }
	catch (cause) { return fail(code, path, `Malformed JSON at ${path}`, cause); }
}
function parsed<T>(candidate: unknown, schema: z.ZodType<T>, path: string, code: EvaluationScorecardError["code"]): T {
	const result = schema.safeParse(candidate);
	if (!result.success) return fail(code, path, `Contract rejected ${path}: ${result.error.message}`, result.error);
	return result.data;
}
function unique(values: readonly string[], path: string, code: EvaluationScorecardError["code"], message: string): void {
	if (new Set(values).size !== values.length) fail(code, path, message);
}
function localSourcePaths(entries: readonly string[]): string[] {
	return [...entries];
}
function publicationDateForEvidenceDate(evidenceDate: string): string {
	const [year, month, day] = evidenceDate.split("-").map(Number);
	const shifted = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + 1));
	const candidate = `${String(shifted.getUTCFullYear()).padStart(4, "0")}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
	if (evidenceDateForPublicationDate(candidate) !== evidenceDate) fail("corpus_binding_mismatch", evidenceDate, "Evidence date does not round-trip to a publication date");
	return candidate;
}
async function localSourceReference(localDataRoot: string, path: string): Promise<EvaluationLocalSourceReference> {
	try { return await sourceReferenceForLocalFile(localDataRoot, path); }
	catch (cause) {
		const target = cause instanceof EvaluationLocalSourceError ? cause.path : path;
		return fail("source_unreadable", target, "Cannot resolve local source reference", cause);
	}
}
async function readLocalSource(localDataRoot: string, reference: EvaluationLocalSourceReference, code: EvaluationScorecardError["code"], message: string): Promise<Uint8Array> {
	try { return await readEvaluationLocalSource(localDataRoot, reference); }
	catch (cause) {
		const target = cause instanceof EvaluationLocalSourceError ? cause.path : sourcePath(reference);
		return fail(code, target, message, cause);
	}
}

async function loadCorpusEntry(localDataRoot: string, entry: ManifestEntry, corpusRoot: string): Promise<LoadedEvaluationReferenceCorpusEntry> {
	const evidencePath = `${corpusRoot}/evidence/${entry.id}.json`;
	const referencePath = `${corpusRoot}/references/${entry.id}.json`;
	if (entry.evidence_path !== evidencePath || entry.reference_path !== referencePath) fail("corpus_binding_mismatch", corpusRoot, `Manifest paths for ${entry.id} are not canonical local-data paths`);
	const [evidenceReference, referenceReference] = await Promise.all([
		localSourceReference(localDataRoot, evidencePath),
		localSourceReference(localDataRoot, referencePath),
	]);
	const [evidenceBytes, referenceBytes] = await Promise.all([
		readLocalSource(localDataRoot, evidenceReference, "corpus_binding_mismatch", "Cannot read corpus evidence"),
		readLocalSource(localDataRoot, referenceReference, "corpus_binding_mismatch", "Cannot read corpus reference"),
	]);
	const fixture = parsed(JSON.parse(Buffer.from(evidenceBytes).toString("utf8")) as unknown, EvidenceFixtureSchema, evidencePath, "corpus_binding_mismatch");
	const reference = parsed(JSON.parse(Buffer.from(referenceBytes).toString("utf8")) as unknown, EvaluationReferenceSchema, referencePath, "corpus_binding_mismatch");
	if (reference.fixture_id !== entry.id) fail("corpus_binding_mismatch", referencePath, `Reference identity mismatch for ${entry.id}`);
	const publicationDate = publicationDateForEvidenceDate(fixture.evidence_date);
	const preparedEvidence = prepareEvidence({ activeRegionId: fixture.active_region_id, publicationDate, messages: fixture.messages });
	return { manifestEntry: entry, evidencePath, evidenceBytes, fixture, publicationDate, preparedEvidence, referencePath, referenceBytes, reference };
}

async function loadLocalEvaluationReferenceCorpus(localDataRoot: string, sourceReference: EvaluationLocalSourceReference): Promise<LoadedEvaluationReferenceCorpus> {
	const manifestPath = sourcePath(sourceReference);
	if (!manifestPath.endsWith("/manifest.json")) fail("corpus_binding_mismatch", manifestPath, "Manifest path must end with /manifest.json");
	const corpusRoot = manifestPath.slice(0, -"/manifest.json".length);
	const manifestBytes = await readLocalSource(localDataRoot, sourceReference, "corpus_binding_mismatch", "Cannot read evaluation reference corpus manifest");
	const manifest = parsed(JSON.parse(Buffer.from(manifestBytes).toString("utf8")) as unknown, EvaluationReferenceManifestSchema, manifestPath, "corpus_binding_mismatch");
	unique(manifest.fixtures.map(({ id }) => id), manifestPath, "corpus_binding_mismatch", "Fixture ids must be unique");
	for (const [index, entry] of manifest.fixtures.entries()) if (entry.ordinal !== index + 1) fail("corpus_binding_mismatch", manifestPath, "Fixture ordinals must match manifest order");
	const expectedPaths = manifest.fixtures.flatMap(({ id }) => [`${corpusRoot}/evidence/${id}.json`, `${corpusRoot}/references/${id}.json`]).sort();
	let actualPaths: string[];
	try { actualPaths = localSourcePaths(await listEvaluationLocalSources(localDataRoot, corpusRoot)).filter((path) => path !== manifestPath).sort(); }
	catch (cause) {
		const target = cause instanceof EvaluationLocalSourceError ? cause.path : corpusRoot;
		return fail("corpus_binding_mismatch", target, "Cannot list local corpus sources", cause);
	}
	if (actualPaths.length !== expectedPaths.length || actualPaths.some((path, index) => path !== expectedPaths[index])) fail("corpus_binding_mismatch", manifestPath, "Local corpus files do not exactly match the manifest");
	const entries: LoadedEvaluationReferenceCorpusEntry[] = [];
	for (const entry of manifest.fixtures) entries.push(await loadCorpusEntry(localDataRoot, entry, corpusRoot));
	return { sourceReference, manifestPath, manifestBytes, manifest, entries };
}

export async function loadEvaluationScorecardInputAtReference(localDataRoot: string, sourceReference: EvaluationLocalSourceReference): Promise<LoadedEvaluationScorecardInput> {
	const declarationPath = sourcePath(sourceReference);
	const declarationBytes = await readLocalSource(localDataRoot, sourceReference, "source_unreadable", "Cannot read scorecard declaration");
	const declaration = parsed(json(declarationBytes, declarationPath, "invalid_declaration_json"), EvaluationScorecardDeclarationSchema, declarationPath, "declaration_rejected");
	const corpus = await loadLocalEvaluationReferenceCorpus(localDataRoot, declaration.corpus.source_reference);
	const runs: LoadedScorecardRun[] = []; let expectedRepetitionCount: number | undefined;
	for (const [index, declared] of declaration.runs.entries()) {
		const runPath = sourcePath(declared.source_reference);
		const runBytes = await readLocalSource(localDataRoot, declared.source_reference, "source_unreadable", "Cannot read Benchmark Run source");
		const run = parseEvaluationScorecardBenchmark(json(runBytes, runPath, "benchmark_artifact_malformed"), declared.benchmark_run_id, declaration.configuration_identity, runPath, expectedRepetitionCount);
		expectedRepetitionCount ??= run.declaration.repetition_count;
		runs.push({ declaration: declared, sourceReference: declared.source_reference, bytes: runBytes, run, corpusEntry: corpus.entries[index]! });
	}
	const annotationPath = sourcePath(declaration.annotations.source_reference);
	const reviewPath = sourcePath(declaration.qualitative_reviews.source_reference);
	const [annotationBytes, reviewBytes] = await Promise.all([
		readLocalSource(localDataRoot, declaration.annotations.source_reference, "source_unreadable", "Cannot read Codex evaluation annotations"),
		readLocalSource(localDataRoot, declaration.qualitative_reviews.source_reference, "source_unreadable", "Cannot read Codex evaluation reviews"),
	]);
	const annotations = parsed(json(annotationBytes, annotationPath, "annotation_bundle_rejected"), AnnotationBundleSchema, annotationPath, "annotation_bundle_rejected");
	const reviews = parsed(json(reviewBytes, reviewPath, "review_bundle_rejected"), QualitativeReviewBundleSchema, reviewPath, "review_bundle_rejected");
	if (annotations.id !== declaration.annotations.bundle_id || reviews.id !== declaration.qualitative_reviews.bundle_id) fail("evidence_set_mismatch", declarationPath, "Codex evidence bundle identity does not match the declaration");
	return validateLoadedEvaluationScorecardInput({ localDataRoot, sourceReference, declarationPath, declarationBytes, declaration, corpus, runs, annotationBytes, annotations, reviewBytes, reviews });
}

export async function loadEvaluationScorecardInput(declarationPath: string, localDataRoot: string): Promise<LoadedEvaluationScorecardInput> {
	return loadEvaluationScorecardInputAtReference(localDataRoot, await localSourceReference(localDataRoot, declarationPath));
}
