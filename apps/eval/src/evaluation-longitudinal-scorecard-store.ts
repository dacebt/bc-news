import { createHash } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { EvaluationIdSchema } from "./evaluation-artifact-schemas";
import { buildEvaluationLongitudinalScorecard } from "./evaluation-longitudinal-scorecard-builder";
import { buildEvaluationLongitudinalScorecardV2 } from "./evaluation-longitudinal-scorecard-builder-v2";
import { loadEvaluationLongitudinalInputAtReference } from "./evaluation-longitudinal-scorecard-input";
import { loadEvaluationLongitudinalInputAtReferenceV2 } from "./evaluation-longitudinal-scorecard-input-v2";
import {
	EvaluationLongitudinalDeclarationV1Schema,
	EvaluationLongitudinalError,
	EvaluationLongitudinalScorecardArtifactSchema,
	type AnyEvaluationLongitudinalScorecardArtifact,
	type EvaluationLongitudinalScorecardArtifact,
} from "./evaluation-longitudinal-scorecard";
import {
	EvaluationLongitudinalScorecardArtifactV2Schema,
	type EvaluationLongitudinalScorecardArtifactV2,
} from "./evaluation-longitudinal-scorecard-v2";
import {
	EvaluationLongitudinalScorecardArtifactV1Schema,
	type EvaluationLongitudinalScorecardArtifactV1,
} from "./evaluation-longitudinal-scorecard-v1";
import { reconstructEvaluationScorecardArtifactV1 } from "./evaluation-scorecard-store";
import { evaluationFreshness, type EvaluationFreshness } from "./evaluation-repository-reference";

export interface EvaluationLongitudinalArtifactRoots {
	readonly repositoryRoot?: string;
	readonly localDataRoot?: string;
}

type RootsInput = string | EvaluationLongitudinalArtifactRoots | undefined;

function fail(code: EvaluationLongitudinalError["code"], path: string, message: string, cause?: unknown): never {
	throw new EvaluationLongitudinalError(code, path, message, cause === undefined ? undefined : { cause });
}

function normalizeRoots(input: RootsInput): EvaluationLongitudinalArtifactRoots {
	return typeof input === "string" ? { repositoryRoot: input } : input ?? {};
}

function requireRepositoryRoot(roots: EvaluationLongitudinalArtifactRoots, path: string, code: "series_invalid" | "series_create_rejected"): string {
	if (roots.repositoryRoot === undefined) fail(code, path, "Repository root is required for repository-addressed longitudinal reconstruction");
	return roots.repositoryRoot;
}

function requireLocalDataRoot(roots: EvaluationLongitudinalArtifactRoots, path: string, code: "series_invalid" | "series_create_rejected"): string {
	if (roots.localDataRoot === undefined) fail(code, path, "Local-data root is required for local longitudinal reconstruction");
	return roots.localDataRoot;
}

function hash(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
function decodeV1(encoded: string, path: string): Uint8Array {
	const bytes = Buffer.from(encoded, "base64");
	if (bytes.toString("base64") !== encoded) fail("series_artifact_tampered", path, "Historical payload is not canonical base64");
	return bytes;
}
function parseV1(bytes: Uint8Array, path: string): unknown {
	try { return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown; }
	catch (cause) { return fail("series_artifact_tampered", path, "Historical embedded source is malformed JSON", cause); }
}

export function reconstructEvaluationLongitudinalScorecardArtifactV1(candidate: unknown, path: string): EvaluationLongitudinalScorecardArtifactV1 {
	const result = EvaluationLongitudinalScorecardArtifactV1Schema.safeParse(candidate);
	if (!result.success) fail("series_invalid", path, `Historical longitudinal contract rejected: ${result.error.message}`, result.error);
	const artifact = result.data; const declarationBytes = decodeV1(artifact.source_payloads.declaration_base64, path);
	if (hash(declarationBytes) !== artifact.declaration_sha256) fail("series_artifact_tampered", path, "Historical longitudinal declaration hash changed");
	const declarationResult = EvaluationLongitudinalDeclarationV1Schema.safeParse(parseV1(declarationBytes, path));
	if (!declarationResult.success) fail("series_artifact_tampered", path, "Historical longitudinal declaration contract changed", declarationResult.error);
	const declaration = declarationResult.data;
	if (artifact.source_payloads.scorecards.length !== declaration.scorecards.length || artifact.scorecard_hashes.length !== declaration.scorecards.length) fail("series_artifact_tampered", path, "Historical longitudinal source roster length changed");
	let previousCreatedAt = Number.NEGATIVE_INFINITY;
	for (const [index, descriptor] of declaration.scorecards.entries()) {
		const embedded = artifact.source_payloads.scorecards[index]; const listed = artifact.scorecard_hashes[index];
		if (embedded === undefined || listed === undefined || embedded.ordinal !== descriptor.ordinal || embedded.phase !== descriptor.phase || embedded.scorecard_id !== descriptor.scorecard_id || listed.ordinal !== descriptor.ordinal || listed.phase !== descriptor.phase || listed.scorecard_id !== descriptor.scorecard_id || listed.scorecard_sha256 !== descriptor.scorecard_sha256) fail("series_artifact_tampered", path, "Historical longitudinal scorecard roster changed");
		const bytes = decodeV1(embedded.bytes_base64, path);
		if (hash(bytes) !== descriptor.scorecard_sha256) fail("series_artifact_tampered", path, "Historical embedded scorecard hash changed");
		const scorecard = reconstructEvaluationScorecardArtifactV1(parseV1(bytes, path), path);
		if (scorecard.id !== descriptor.scorecard_id || scorecard.created_at !== listed.created_at || Date.parse(scorecard.created_at) <= previousCreatedAt) fail("series_artifact_tampered", path, "Historical embedded scorecard identity or chronology changed");
		previousCreatedAt = Date.parse(scorecard.created_at);
	}
	return artifact;
}

async function recomputeV2(candidate: EvaluationLongitudinalScorecardArtifactV2, repositoryRoot: string, sourcePath: string): Promise<EvaluationLongitudinalScorecardArtifactV2> {
	let input;
	try { input = await loadEvaluationLongitudinalInputAtReferenceV2(repositoryRoot, candidate.source_reference); }
	catch (cause) { return fail("series_artifact_tampered", sourcePath, "Recorded repository longitudinal evidence cannot be resolved", cause); }
	return buildEvaluationLongitudinalScorecardV2(input, { id: candidate.id, createdAt: candidate.created_at });
}

async function recomputeV3(candidate: EvaluationLongitudinalScorecardArtifact, localDataRoot: string, sourcePath: string): Promise<EvaluationLongitudinalScorecardArtifact> {
	let input;
	try { input = await loadEvaluationLongitudinalInputAtReference(localDataRoot, candidate.source_reference); }
	catch (cause) { return fail("series_artifact_tampered", sourcePath, "Recorded local longitudinal evidence cannot be resolved", cause); }
	return buildEvaluationLongitudinalScorecard(input, { id: candidate.id, createdAt: candidate.created_at });
}

async function validatedV2(candidate: unknown, path: string, repositoryRoot: string, code: "series_invalid" | "series_create_rejected"): Promise<EvaluationLongitudinalScorecardArtifactV2> {
	const result = EvaluationLongitudinalScorecardArtifactV2Schema.safeParse(candidate);
	if (!result.success) fail(code, path, `Repository-addressed longitudinal artifact contract rejected: ${result.error.message}`, result.error);
	const rebuilt = await recomputeV2(result.data, repositoryRoot, path);
	if (!isDeepStrictEqual(rebuilt, result.data)) fail(code === "series_create_rejected" ? code : "series_artifact_tampered", path, "Repository-addressed longitudinal derived evidence does not reconstruct exactly");
	return result.data;
}

async function validatedV3(candidate: unknown, path: string, localDataRoot: string, code: "series_invalid" | "series_create_rejected"): Promise<EvaluationLongitudinalScorecardArtifact> {
	const result = EvaluationLongitudinalScorecardArtifactSchema.safeParse(candidate);
	if (!result.success) fail(code, path, `Local-data longitudinal artifact contract rejected: ${result.error.message}`, result.error);
	const rebuilt = await recomputeV3(result.data, localDataRoot, path);
	if (!isDeepStrictEqual(rebuilt, result.data)) fail(code === "series_create_rejected" ? code : "series_artifact_tampered", path, "Local-data longitudinal derived evidence does not reconstruct exactly");
	return result.data;
}

export async function createEvaluationLongitudinalScorecardArtifact(path: string, artifact: EvaluationLongitudinalScorecardArtifact, roots: EvaluationLongitudinalArtifactRoots): Promise<EvaluationLongitudinalScorecardArtifact>;
export async function createEvaluationLongitudinalScorecardArtifact(path: string, artifact: EvaluationLongitudinalScorecardArtifactV2, roots: EvaluationLongitudinalArtifactRoots | string): Promise<EvaluationLongitudinalScorecardArtifactV2>;
export async function createEvaluationLongitudinalScorecardArtifact(path: string, artifact: EvaluationLongitudinalScorecardArtifactV1, roots?: EvaluationLongitudinalArtifactRoots | string): Promise<EvaluationLongitudinalScorecardArtifactV1>;
export async function createEvaluationLongitudinalScorecardArtifact(path: string, artifact: AnyEvaluationLongitudinalScorecardArtifact, rootsInput?: RootsInput): Promise<AnyEvaluationLongitudinalScorecardArtifact> {
	if (basename(path) !== `${artifact.id}.json`) fail("series_create_rejected", path, "Longitudinal artifact path must use its id as filename");
	const roots = normalizeRoots(rootsInput);
	const candidate = artifact.version === 1
		? reconstructEvaluationLongitudinalScorecardArtifactV1(artifact, path)
		: artifact.version === 2
			? await validatedV2(artifact, path, requireRepositoryRoot(roots, path, "series_create_rejected"), "series_create_rejected")
			: await validatedV3(artifact, path, requireLocalDataRoot(roots, path, "series_create_rejected"), "series_create_rejected");
	try { await writeFile(path, `${JSON.stringify(candidate, null, 2)}\n`, { encoding: "utf8", flag: "wx" }); }
	catch (cause) { return fail("series_create_rejected", path, "Could not exclusively create longitudinal artifact", cause); }
	try { return await loadEvaluationLongitudinalScorecardArtifact(candidate.id, dirname(path), roots); }
	catch (cause) {
		try { await unlink(path); } catch { /* primary create failure remains authoritative */ }
		return fail("series_create_rejected", path, "Longitudinal read-after-write validation failed", cause);
	}
}

export async function loadEvaluationLongitudinalScorecardArtifact(id: string, directory: string, rootsInput?: RootsInput): Promise<AnyEvaluationLongitudinalScorecardArtifact> {
	const idResult = EvaluationIdSchema.safeParse(id);
	if (!idResult.success) fail("invalid_series_id", directory, `Invalid longitudinal series id: ${id}`, idResult.error);
	const path = join(directory, `${idResult.data}.json`); let raw: Uint8Array;
	try { raw = await readFile(path); }
	catch (cause) { return fail((cause as NodeJS.ErrnoException).code === "ENOENT" ? "series_not_found" : "series_invalid", path, "Cannot read longitudinal artifact", cause); }
	let candidate: unknown;
	try { candidate = JSON.parse(Buffer.from(raw).toString("utf8")) as unknown; }
	catch (cause) { return fail("series_malformed", path, "Malformed longitudinal artifact JSON", cause); }
	const roots = normalizeRoots(rootsInput);
	const artifact = typeof candidate === "object" && candidate !== null && "version" in candidate && candidate.version === 1
		? reconstructEvaluationLongitudinalScorecardArtifactV1(candidate, path)
		: typeof candidate === "object" && candidate !== null && "version" in candidate && candidate.version === 2
			? await validatedV2(candidate, path, requireRepositoryRoot(roots, path, "series_invalid"), "series_invalid")
			: await validatedV3(candidate, path, requireLocalDataRoot(roots, path, "series_invalid"), "series_invalid");
	if (artifact.id !== idResult.data) fail("series_filename_mismatch", path, "Longitudinal artifact filename identity mismatch");
	return artifact;
}

export interface LongitudinalFreshness {
	readonly scorecard_id: string;
	readonly source_reference: EvaluationLongitudinalScorecardArtifact["scorecard_references"][number]["source_reference"];
	readonly code: EvaluationFreshness;
}

export async function evaluationLongitudinalFreshness(artifact: EvaluationLongitudinalScorecardArtifact, repositoryRoot: string): Promise<readonly LongitudinalFreshness[]> {
	return Promise.all(artifact.scorecard_references.map(async (source) => ({
		scorecard_id: source.scorecard_id,
		source_reference: source.source_reference,
		code: await evaluationFreshness(repositoryRoot, source.evaluated_code_commit_sha),
	})));
}
