import { createHash } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { BenchmarkRunSchema } from "./evaluation-artifact";
import { EvaluationIdSchema } from "./evaluation-artifact-schemas";
import { EvidenceFixtureSchema } from "@bc-news/contracts";
import { EvaluationReferenceManifestV1Schema, EvaluationReferenceV1Schema } from "./evaluation-reference-corpus";
import { buildEvaluationScorecard } from "./evaluation-scorecard-builder";
import { buildEvaluationScorecard as buildEvaluationScorecardV3 } from "./evaluation-scorecard-builder-v3";
import { buildEvaluationScorecardV2 } from "./evaluation-scorecard-builder-v2";
import { loadEvaluationScorecardInputAtReference } from "./evaluation-scorecard-input";
import { loadEvaluationScorecardInputAtReference as loadEvaluationScorecardInputAtReferenceV3 } from "./evaluation-scorecard-input-v3";
import { loadEvaluationScorecardInputAtReference as loadEvaluationScorecardInputAtReferenceV2 } from "./evaluation-scorecard-input-v2";
import {
	AnnotationBundleV1Schema,
	EvaluationScorecardArtifactSchema,
	EvaluationScorecardArtifactV1Schema,
	EvaluationScorecardArtifactV3Schema,
	EvaluationScorecardArtifactV2Schema,
	EvaluationScorecardDeclarationV1Schema,
	QualitativeReviewBundleV1Schema,
	EvaluationScorecardError,
	type AnyEvaluationScorecardArtifact,
	type EvaluationScorecardArtifact,
	type EvaluationScorecardArtifactV3,
	type EvaluationScorecardArtifactV1,
	type EvaluationScorecardArtifactV2,
} from "./evaluation-scorecard";
import { evaluationFreshness, type EvaluationFreshness } from "./evaluation-repository-reference";

export interface EvaluationScorecardRoots {
	readonly repositoryRoot?: string;
	readonly localDataRoot?: string;
}

function fail(code: EvaluationScorecardError["code"], path: string, message: string, cause?: unknown): never {
	throw new EvaluationScorecardError(code, path, message, cause === undefined ? undefined : { cause });
}
function hash(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
function decodeV1(encoded: string, path: string): Uint8Array {
	const bytes = Buffer.from(encoded, "base64");
	if (bytes.toString("base64") !== encoded) fail("artifact_tampered", path, "Historical payload is not canonical base64");
	return bytes;
}
function parseV1(bytes: Uint8Array, path: string): unknown {
	try { return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown; }
	catch (cause) { return fail("artifact_tampered", path, "Historical embedded source is malformed JSON", cause); }
}
function rootsValue(roots?: string | EvaluationScorecardRoots): EvaluationScorecardRoots {
	return typeof roots === "string" ? { repositoryRoot: roots } : roots ?? {};
}
function requireRepositoryRoot(roots: EvaluationScorecardRoots, path: string, code: EvaluationScorecardError["code"]): string {
	return roots.repositoryRoot ?? fail(code, path, "Repository root is required for scorecard V2 reconstruction");
}
function requireLocalDataRoot(roots: EvaluationScorecardRoots, path: string, code: EvaluationScorecardError["code"]): string {
	return roots.localDataRoot ?? fail(code, path, "Local data root is required for scorecard V3 reconstruction");
}

export function reconstructEvaluationScorecardArtifactV1(candidate: unknown, path: string): EvaluationScorecardArtifactV1 {
	const result = EvaluationScorecardArtifactV1Schema.safeParse(candidate);
	if (!result.success) fail("scorecard_invalid", path, `Historical scorecard contract rejected: ${result.error.message}`, result.error);
	const artifact = result.data; const payload = artifact.source_payloads;
	const declarationBytes = decodeV1(payload.declaration_base64, path);
	if (hash(declarationBytes) !== artifact.declaration_sha256) fail("artifact_tampered", path, "Historical declaration hash changed");
	const declarationResult = EvaluationScorecardDeclarationV1Schema.safeParse(parseV1(declarationBytes, path));
	if (!declarationResult.success) fail("artifact_tampered", path, "Historical declaration contract changed", declarationResult.error);
	const declaration = declarationResult.data;
	const manifestBytes = decodeV1(payload.corpus_manifest_base64, path);
	if (hash(manifestBytes) !== declaration.corpus.manifest_sha256 || artifact.corpus.manifest_sha256 !== declaration.corpus.manifest_sha256) fail("artifact_tampered", path, "Historical corpus manifest hash changed");
	const manifestResult = EvaluationReferenceManifestV1Schema.safeParse(parseV1(manifestBytes, path));
	if (!manifestResult.success || manifestResult.data.id !== artifact.corpus.id || manifestResult.data.fixtures.length !== artifact.corpus.fixture_count) fail("artifact_tampered", path, "Historical corpus identity changed", manifestResult.success ? undefined : manifestResult.error);
	const annotationBytes = decodeV1(payload.annotation_bundle_base64, path); const reviewBytes = decodeV1(payload.qualitative_review_bundle_base64, path);
	if (hash(annotationBytes) !== declaration.annotations.sha256 || !AnnotationBundleV1Schema.safeParse(parseV1(annotationBytes, path)).success) fail("artifact_tampered", path, "Historical annotation source changed");
	if (hash(reviewBytes) !== declaration.qualitative_reviews.sha256 || !QualitativeReviewBundleV1Schema.safeParse(parseV1(reviewBytes, path)).success) fail("artifact_tampered", path, "Historical review source changed");
	if (payload.corpus_entries.length !== declaration.runs.length || payload.benchmark_runs.length !== declaration.runs.length || artifact.benchmark_run_hashes.length !== declaration.runs.length) fail("artifact_tampered", path, "Historical source roster length changed");
	for (const [index, declared] of declaration.runs.entries()) {
		const manifestEntry = manifestResult.data.fixtures[index]; const corpusEntry = payload.corpus_entries[index]; const runEntry = payload.benchmark_runs[index]; const listed = artifact.benchmark_run_hashes[index];
		if (manifestEntry === undefined || corpusEntry === undefined || runEntry === undefined || listed === undefined || declared.corpus_fixture_id !== manifestEntry.id || corpusEntry.fixture_id !== manifestEntry.id || runEntry.run_id !== declared.benchmark_run_id || listed.benchmark_run_id !== declared.benchmark_run_id || listed.benchmark_run_sha256 !== declared.benchmark_run_sha256) fail("artifact_tampered", path, "Historical source roster changed");
		const evidenceBytes = decodeV1(corpusEntry.evidence_base64, path); const referenceBytes = decodeV1(corpusEntry.reference_base64, path); const runBytes = decodeV1(runEntry.bytes_base64, path);
		if (hash(evidenceBytes) !== manifestEntry.evidence_sha256 || hash(referenceBytes) !== manifestEntry.reference_sha256 || hash(runBytes) !== declared.benchmark_run_sha256) fail("artifact_tampered", path, "Historical embedded source hash changed");
		if (!EvidenceFixtureSchema.safeParse(parseV1(evidenceBytes, path)).success || !EvaluationReferenceV1Schema.safeParse(parseV1(referenceBytes, path)).success) fail("artifact_tampered", path, "Historical corpus entry contract changed");
		const runResult = BenchmarkRunSchema.safeParse(parseV1(runBytes, path));
		if (!runResult.success || runResult.data.id !== declared.benchmark_run_id) fail("artifact_tampered", path, "Historical Benchmark Run contract changed", runResult.success ? undefined : runResult.error);
	}
	return artifact;
}

async function recomputeV2(candidate: EvaluationScorecardArtifactV2, repositoryRoot: string, sourcePath: string): Promise<EvaluationScorecardArtifactV2> {
	let input;
	try { input = await loadEvaluationScorecardInputAtReferenceV2(repositoryRoot, candidate.source_reference); }
	catch (cause) { return fail("artifact_tampered", sourcePath, "Recorded scorecard V2 evidence cannot be resolved", cause); }
	return buildEvaluationScorecardV2(input, { id: candidate.id, createdAt: candidate.created_at });
}

async function recomputeV3(candidate: EvaluationScorecardArtifact, localDataRoot: string, sourcePath: string): Promise<EvaluationScorecardArtifact> {
	let input;
	try { input = await loadEvaluationScorecardInputAtReference(localDataRoot, candidate.source_reference); }
	catch (cause) { return fail("artifact_tampered", sourcePath, "Recorded scorecard V3 evidence cannot be resolved", cause); }
	return buildEvaluationScorecard(input, { id: candidate.id, createdAt: candidate.created_at });
}

async function recomputeHistoricalV3(candidate: EvaluationScorecardArtifactV3, localDataRoot: string, sourcePath: string): Promise<EvaluationScorecardArtifactV3> {
	let input;
	try { input = await loadEvaluationScorecardInputAtReferenceV3(localDataRoot, candidate.source_reference); }
	catch (cause) { return fail("artifact_tampered", sourcePath, "Historical scorecard V3 evidence cannot be resolved", cause); }
	return buildEvaluationScorecardV3(input, { id: candidate.id, createdAt: candidate.created_at });
}

async function validatedArtifactV2(candidate: unknown, path: string, repositoryRoot: string, malformedCode: "scorecard_malformed" | "scorecard_create_rejected", invalidCode: "scorecard_invalid" | "scorecard_create_rejected"): Promise<EvaluationScorecardArtifactV2> {
	if (candidate === undefined) fail(malformedCode, path, "Scorecard artifact is malformed");
	const result = EvaluationScorecardArtifactV2Schema.safeParse(candidate);
	if (!result.success) fail(invalidCode, path, `Scorecard V2 contract rejected: ${result.error.message}`, result.error);
	const rebuilt = await recomputeV2(result.data, repositoryRoot, path);
	if (!isDeepStrictEqual(rebuilt, result.data)) fail("artifact_tampered", path, "Scorecard V2 derived evidence does not reconstruct exactly");
	return result.data;
}

async function validatedArtifactV3(candidate: unknown, path: string, localDataRoot: string, malformedCode: "scorecard_malformed" | "scorecard_create_rejected", invalidCode: "scorecard_invalid" | "scorecard_create_rejected"): Promise<EvaluationScorecardArtifact> {
	if (candidate === undefined) fail(malformedCode, path, "Scorecard artifact is malformed");
	const result = EvaluationScorecardArtifactSchema.safeParse(candidate);
	if (!result.success) fail(invalidCode, path, `Scorecard V3 contract rejected: ${result.error.message}`, result.error);
	const rebuilt = await recomputeV3(result.data, localDataRoot, path);
	if (!isDeepStrictEqual(rebuilt, result.data)) fail("artifact_tampered", path, "Scorecard V3 derived evidence does not reconstruct exactly");
	return result.data;
}

async function validatedHistoricalArtifactV3(candidate: unknown, path: string, localDataRoot: string, malformedCode: "scorecard_malformed" | "scorecard_create_rejected", invalidCode: "scorecard_invalid" | "scorecard_create_rejected"): Promise<EvaluationScorecardArtifactV3> {
	if (candidate === undefined) fail(malformedCode, path, "Scorecard artifact is malformed");
	const result = EvaluationScorecardArtifactV3Schema.safeParse(candidate);
	if (!result.success) fail(invalidCode, path, `Scorecard V3 contract rejected: ${result.error.message}`, result.error);
	const rebuilt = await recomputeHistoricalV3(result.data, localDataRoot, path);
	if (!isDeepStrictEqual(rebuilt, result.data)) fail("artifact_tampered", path, "Scorecard V3 derived evidence does not reconstruct exactly");
	return result.data;
}

export async function validateEvaluationScorecardArtifact(candidate: unknown, path: string, roots?: string | EvaluationScorecardRoots): Promise<AnyEvaluationScorecardArtifact> {
	const normalized = rootsValue(roots);
	const version = typeof candidate === "object" && candidate !== null && "version" in candidate ? candidate.version : undefined;
	if (version === 1) return reconstructEvaluationScorecardArtifactV1(candidate, path);
	if (version === 2) return validatedArtifactV2(candidate, path, requireRepositoryRoot(normalized, path, "scorecard_invalid"), "scorecard_malformed", "scorecard_invalid");
	if (version === 3) return validatedHistoricalArtifactV3(candidate, path, requireLocalDataRoot(normalized, path, "scorecard_invalid"), "scorecard_malformed", "scorecard_invalid");
	if (version === 4) return validatedArtifactV3(candidate, path, requireLocalDataRoot(normalized, path, "scorecard_invalid"), "scorecard_malformed", "scorecard_invalid");
	fail("scorecard_invalid", path, "Unsupported evaluation scorecard version");
}

export async function validateEvaluationScorecardArtifactV2(candidate: unknown, path: string, repositoryRoot: string): Promise<EvaluationScorecardArtifactV2> {
	return validatedArtifactV2(candidate, path, repositoryRoot, "scorecard_malformed", "scorecard_invalid");
}

export async function validateEvaluationScorecardArtifactV3(candidate: unknown, path: string, localDataRoot: string): Promise<EvaluationScorecardArtifact> {
	return validatedArtifactV3(candidate, path, localDataRoot, "scorecard_malformed", "scorecard_invalid");
}

export async function createEvaluationScorecardArtifact(path: string, artifact: EvaluationScorecardArtifact, roots: EvaluationScorecardRoots): Promise<EvaluationScorecardArtifact>;
export async function createEvaluationScorecardArtifact(path: string, artifact: EvaluationScorecardArtifactV2, roots: EvaluationScorecardRoots | string): Promise<EvaluationScorecardArtifactV2>;
export async function createEvaluationScorecardArtifact(path: string, artifact: EvaluationScorecardArtifactV1, roots?: EvaluationScorecardRoots | string): Promise<EvaluationScorecardArtifactV1>;
export async function createEvaluationScorecardArtifact(path: string, artifact: AnyEvaluationScorecardArtifact, roots?: EvaluationScorecardRoots | string): Promise<AnyEvaluationScorecardArtifact> {
	if (basename(path) !== `${artifact.id}.json`) fail("scorecard_create_rejected", path, "Scorecard path must use its artifact id as filename");
	const normalized = rootsValue(roots);
	const candidate = artifact.version === 1
		? reconstructEvaluationScorecardArtifactV1(artifact, path)
		: artifact.version === 2
			? await validatedArtifactV2(artifact, path, requireRepositoryRoot(normalized, path, "scorecard_create_rejected"), "scorecard_create_rejected", "scorecard_create_rejected")
			: artifact.version === 3
				? await validatedHistoricalArtifactV3(artifact, path, requireLocalDataRoot(normalized, path, "scorecard_create_rejected"), "scorecard_create_rejected", "scorecard_create_rejected")
				: await validatedArtifactV3(artifact, path, requireLocalDataRoot(normalized, path, "scorecard_create_rejected"), "scorecard_create_rejected", "scorecard_create_rejected");
	try { await writeFile(path, `${JSON.stringify(candidate, null, 2)}\n`, { encoding: "utf8", flag: "wx" }); }
	catch (cause) { return fail("scorecard_create_rejected", path, "Could not exclusively create scorecard artifact", cause); }
	try { return await loadEvaluationScorecardArtifact(candidate.id, dirname(path), normalized); }
	catch (cause) {
		try { await unlink(path); } catch { /* primary create failure remains authoritative */ }
		return fail("scorecard_create_rejected", path, "Scorecard read-after-write validation failed", cause);
	}
}

export async function loadEvaluationScorecardArtifact(id: string, directory: string, roots?: string | EvaluationScorecardRoots): Promise<AnyEvaluationScorecardArtifact> {
	const parsedId = EvaluationIdSchema.safeParse(id);
	if (!parsedId.success) fail("invalid_scorecard_id", directory, `Invalid scorecard id: ${id}`, parsedId.error);
	const path = join(directory, `${parsedId.data}.json`); let raw: Uint8Array;
	try { raw = await readFile(path); }
	catch (cause) { return fail((cause as NodeJS.ErrnoException).code === "ENOENT" ? "scorecard_not_found" : "scorecard_invalid", path, "Cannot read scorecard artifact", cause); }
	let candidate: unknown;
	try { candidate = JSON.parse(Buffer.from(raw).toString("utf8")) as unknown; }
	catch (cause) { return fail("scorecard_malformed", path, "Malformed scorecard JSON", cause); }
	const artifact = await validateEvaluationScorecardArtifact(candidate, path, roots);
	if (artifact.id !== parsedId.data) fail("scorecard_filename_mismatch", path, "Scorecard filename identity mismatch");
	return artifact;
}

type FreshnessScorecard = EvaluationScorecardArtifact | EvaluationScorecardArtifactV2 | EvaluationScorecardArtifactV3;
export async function evaluationScorecardFreshness(artifact: FreshnessScorecard, repositoryRoot: string): Promise<EvaluationFreshness> {
	const commits = [...new Set(artifact.sources.benchmark_runs.map(({ code_commit_sha }) => code_commit_sha))];
	if (commits.length !== 1) fail("provenance_mismatch", artifact.id, "Scorecard contains more than one evaluated code commit");
	return evaluationFreshness(repositoryRoot, commits[0]!);
}
