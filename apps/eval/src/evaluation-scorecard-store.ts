import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { BenchmarkRunSchema } from "./evaluation-artifact";
import { EvaluationIdSchema } from "./evaluation-artifact-schemas";
import type { V7BenchmarkRun } from "./evaluation-artifact-v7";
import { loadEvaluationReferenceCorpus } from "./evaluation-reference-corpus";
import { buildEvaluationScorecard } from "./evaluation-scorecard-builder";
import { validateLoadedEvaluationScorecardInput, type LoadedScorecardRun } from "./evaluation-scorecard-input";
import {
	AnnotationBundleSchema, EvaluationScorecardArtifactSchema, EvaluationScorecardDeclarationSchema,
	EvaluationScorecardError, QualitativeReviewBundleSchema, type EvaluationScorecardArtifact,
} from "./evaluation-scorecard";

function fail(code: EvaluationScorecardError["code"], path: string, message: string, cause?: unknown): never {
	throw new EvaluationScorecardError(code, path, message, cause === undefined ? undefined : { cause });
}
function hash(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
function decode(encoded: string, path: string): Uint8Array {
	const decoded = Buffer.from(encoded, "base64");
	if (decoded.toString("base64") !== encoded) fail("artifact_tampered", path, "Embedded payload is not canonical base64");
	return decoded;
}
function parseJson(bytes: Uint8Array, path: string): unknown {
	try { return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown; }
	catch (cause) { return fail("artifact_tampered", path, "Embedded scorecard source is malformed JSON", cause); }
}

async function recompute(candidate: EvaluationScorecardArtifact, sourcePath: string): Promise<EvaluationScorecardArtifact> {
	const payload = candidate.source_payloads;
	const declarationBytes = decode(payload.declaration_base64, sourcePath);
	if (hash(declarationBytes) !== candidate.declaration_sha256) fail("artifact_tampered", sourcePath, "Declaration payload hash changed");
	const declarationResult = EvaluationScorecardDeclarationSchema.safeParse(parseJson(declarationBytes, sourcePath));
	if (!declarationResult.success) fail("artifact_tampered", sourcePath, "Embedded declaration contract changed", declarationResult.error);
	const declaration = declarationResult.data;
	const manifestBytes = decode(payload.corpus_manifest_base64, sourcePath);
	if (hash(manifestBytes) !== declaration.corpus.manifest_sha256) fail("artifact_tampered", sourcePath, "Embedded corpus manifest hash changed");
	const annotationBytes = decode(payload.annotation_bundle_base64, sourcePath);
	if (hash(annotationBytes) !== declaration.annotations.sha256) fail("artifact_tampered", sourcePath, "Embedded annotation hash changed");
	const annotationResult = AnnotationBundleSchema.safeParse(parseJson(annotationBytes, sourcePath));
	if (!annotationResult.success) fail("artifact_tampered", sourcePath, "Embedded annotation contract changed", annotationResult.error);
	const reviewBytes = decode(payload.qualitative_review_bundle_base64, sourcePath);
	if (hash(reviewBytes) !== declaration.qualitative_reviews.sha256) fail("artifact_tampered", sourcePath, "Embedded review hash changed");
	const reviewResult = QualitativeReviewBundleSchema.safeParse(parseJson(reviewBytes, sourcePath));
	if (!reviewResult.success) fail("artifact_tampered", sourcePath, "Embedded review contract changed", reviewResult.error);
	if (payload.corpus_entries.length !== declaration.runs.length || payload.benchmark_runs.length !== declaration.runs.length) fail("artifact_tampered", sourcePath, "Embedded source roster length changed");

	const root = await mkdtemp(join(tmpdir(), "bc-news-scorecard-read-")); let cleanupFailure: unknown;
	try {
		const corpusRoot = join(root, "fixtures", "evaluation-corpus"); const evidenceRoot = join(corpusRoot, "evidence"); const referenceRoot = join(corpusRoot, "references");
		await mkdir(evidenceRoot, { recursive: true }); await mkdir(referenceRoot, { recursive: true });
		await writeFile(join(corpusRoot, "manifest.json"), manifestBytes, { flag: "wx" });
		for (const [index, entry] of payload.corpus_entries.entries()) {
			if (entry.fixture_id !== declaration.runs[index]?.corpus_fixture_id) fail("artifact_tampered", sourcePath, "Embedded corpus order changed");
			await writeFile(join(evidenceRoot, `${entry.fixture_id}.json`), decode(entry.evidence_base64, sourcePath), { flag: "wx" });
			await writeFile(join(referenceRoot, `${entry.fixture_id}.json`), decode(entry.reference_base64, sourcePath), { flag: "wx" });
		}
		let corpus;
		try { corpus = await loadEvaluationReferenceCorpus(join(corpusRoot, "manifest.json")); }
		catch (cause) { return fail("artifact_tampered", sourcePath, "Embedded corpus no longer validates", cause); }
		const runs: LoadedScorecardRun[] = [];
		for (const [index, embedded] of payload.benchmark_runs.entries()) {
			const declared = declaration.runs[index]; if (declared === undefined || embedded.run_id !== declared.benchmark_run_id) fail("artifact_tampered", sourcePath, "Embedded Benchmark Run order changed");
			const runBytes = decode(embedded.bytes_base64, sourcePath);
			if (hash(runBytes) !== declared.benchmark_run_sha256) fail("artifact_tampered", sourcePath, "Embedded Benchmark Run hash changed");
			const result = BenchmarkRunSchema.safeParse(parseJson(runBytes, sourcePath));
			if (!result.success || result.data.id !== embedded.run_id) fail("artifact_tampered", sourcePath, "Embedded Benchmark Run contract or identity changed", result.success ? undefined : result.error);
			runs.push({ declaration: declared, bytes: runBytes, run: result.data as V7BenchmarkRun, corpusEntry: corpus.entries[index]! });
		}
		let loaded;
		try { loaded = validateLoadedEvaluationScorecardInput({ declarationPath: sourcePath, declarationBytes, declaration, corpus, runs, annotationBytes, annotations: annotationResult.data, reviewBytes, reviews: reviewResult.data }); }
		catch (cause) { return fail("artifact_tampered", sourcePath, "Embedded scorecard evidence no longer validates", cause); }
		return buildEvaluationScorecard(loaded, { id: candidate.id, createdAt: candidate.created_at });
	} finally {
		try { await rm(root, { recursive: true }); } catch (cause) { cleanupFailure = cause; }
		if (cleanupFailure !== undefined) fail("scorecard_invalid", sourcePath, `Could not clean scorecard reconstruction root ${root}`, cleanupFailure);
	}
}

async function validatedArtifact(candidate: unknown, path: string, malformedCode: "scorecard_malformed" | "scorecard_create_rejected", invalidCode: "scorecard_invalid" | "scorecard_create_rejected"): Promise<EvaluationScorecardArtifact> {
	if (candidate === undefined) fail(malformedCode, path, "Scorecard artifact is malformed");
	const result = EvaluationScorecardArtifactSchema.safeParse(candidate);
	if (!result.success) fail(invalidCode, path, `Scorecard artifact contract rejected: ${result.error.message}`, result.error);
	const rebuilt = await recompute(result.data, path);
	if (!isDeepStrictEqual(rebuilt, result.data)) fail("artifact_tampered", path, "Scorecard derived evidence does not reconstruct exactly");
	return result.data;
}

export async function createEvaluationScorecardArtifact(path: string, artifact: EvaluationScorecardArtifact): Promise<EvaluationScorecardArtifact> {
	if (basename(path) !== `${artifact.id}.json`) fail("scorecard_create_rejected", path, "Scorecard path must use its artifact id as filename");
	const candidate = await validatedArtifact(artifact, path, "scorecard_create_rejected", "scorecard_create_rejected");
	try { await writeFile(path, `${JSON.stringify(candidate, null, 2)}\n`, { encoding: "utf8", flag: "wx" }); }
	catch (cause) { return fail("scorecard_create_rejected", path, "Could not exclusively create scorecard artifact", cause); }
	try { return await loadEvaluationScorecardArtifact(candidate.id, dirname(path)); }
	catch (cause) {
		try { await unlink(path); } catch { /* the create failure remains authoritative */ }
		return fail("scorecard_create_rejected", path, "Scorecard read-after-write validation failed", cause);
	}
}

export async function loadEvaluationScorecardArtifact(id: string, directory: string): Promise<EvaluationScorecardArtifact> {
	const parsedId = EvaluationIdSchema.safeParse(id);
	if (!parsedId.success) fail("invalid_scorecard_id", directory, `Invalid scorecard id: ${id}`, parsedId.error);
	const path = join(directory, `${parsedId.data}.json`); let raw: Uint8Array;
	try { raw = await readFile(path); }
	catch (cause) { return fail((cause as NodeJS.ErrnoException).code === "ENOENT" ? "scorecard_not_found" : "scorecard_invalid", path, "Cannot read scorecard artifact", cause); }
	let candidate: unknown;
	try { candidate = JSON.parse(Buffer.from(raw).toString("utf8")) as unknown; }
	catch (cause) { return fail("scorecard_malformed", path, "Malformed scorecard JSON", cause); }
	const artifact = await validatedArtifact(candidate, path, "scorecard_malformed", "scorecard_invalid");
	if (artifact.id !== parsedId.data) fail("scorecard_filename_mismatch", path, "Scorecard filename identity mismatch");
	return artifact;
}
