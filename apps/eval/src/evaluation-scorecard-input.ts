import { z } from "zod";
import {
	loadLocalEvaluationReferenceCorpusAtReference,
} from "./evaluation-reference-corpus";
import {
	EvaluationLocalSourceError,
	sourceReferenceForLocalFile,
	readEvaluationLocalSource,
	type EvaluationLocalSourceReference,
} from "./evaluation-local-source-reference";
import {
	parseEvaluationScorecardBenchmark,
	type ScorecardBenchmarkRun,
} from "./evaluation-scorecard-input-v2";
import {
	validateLoadedEvaluationScorecardInput,
	type LoadedEvaluationScorecardInput,
	type LoadedScorecardRun,
} from "./evaluation-scorecard-input-validation";
import {
	AnnotationBundleSchema,
	EvaluationScorecardDeclarationSchema,
	EvaluationScorecardError,
	QualitativeReviewBundleSchema,
} from "./evaluation-scorecard";

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

export async function loadEvaluationScorecardInputAtReference(localDataRoot: string, sourceReference: EvaluationLocalSourceReference): Promise<LoadedEvaluationScorecardInput> {
	const declarationPath = sourcePath(sourceReference);
	const declarationBytes = await readLocalSource(localDataRoot, sourceReference, "source_unreadable", "Cannot read scorecard declaration");
	const declaration = parsed(json(declarationBytes, declarationPath, "invalid_declaration_json"), EvaluationScorecardDeclarationSchema, declarationPath, "declaration_rejected");
	const corpus = await loadLocalEvaluationReferenceCorpusAtReference(localDataRoot, declaration.corpus.source_reference);
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
