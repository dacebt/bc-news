import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { EvaluationIdSchema } from "./evaluation-artifact-schemas";
import { buildEvaluationLongitudinalScorecard } from "./evaluation-longitudinal-scorecard-builder";
import { loadEvaluationLongitudinalInput } from "./evaluation-longitudinal-scorecard-input";
import {
	EvaluationLongitudinalDeclarationSchema, EvaluationLongitudinalError,
	EvaluationLongitudinalScorecardArtifactSchema, type EvaluationLongitudinalScorecardArtifact,
} from "./evaluation-longitudinal-scorecard";

function fail(code: EvaluationLongitudinalError["code"], path: string, message: string, cause?: unknown): never {
	throw new EvaluationLongitudinalError(code, path, message, cause === undefined ? undefined : { cause });
}
function hash(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
function decode(encoded: string, path: string): Uint8Array {
	const decoded = Buffer.from(encoded, "base64");
	if (decoded.toString("base64") !== encoded) fail("series_artifact_tampered", path, "Embedded payload is not canonical base64");
	return decoded;
}
function parseEmbedded(bytes: Uint8Array, path: string): unknown {
	try { return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown; }
	catch (cause) { return fail("series_artifact_tampered", path, "Embedded longitudinal source is malformed JSON", cause); }
}
function inside(root: string, target: string): boolean { const fromRoot = relative(root, target); return fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot); }

async function recompute(candidate: EvaluationLongitudinalScorecardArtifact, sourcePath: string): Promise<EvaluationLongitudinalScorecardArtifact> {
	const declarationBytes = decode(candidate.source_payloads.declaration_base64, sourcePath);
	if (hash(declarationBytes) !== candidate.declaration_sha256) fail("series_artifact_tampered", sourcePath, "Embedded declaration hash changed");
	const declarationResult = EvaluationLongitudinalDeclarationSchema.safeParse(parseEmbedded(declarationBytes, sourcePath));
	if (!declarationResult.success) fail("series_artifact_tampered", sourcePath, "Embedded declaration contract changed", declarationResult.error);
	const declaration = declarationResult.data;
	if (candidate.source_payloads.scorecards.length !== declaration.scorecards.length || candidate.scorecard_hashes.length !== declaration.scorecards.length) fail("series_artifact_tampered", sourcePath, "Embedded scorecard roster length changed");
	const virtualRoot = resolve(sep, "bc-news-longitudinal-isolated-root"); const destinations = new Set([resolve(virtualRoot, "declaration.json")]);
	const prepared = declaration.scorecards.map((descriptor, index) => {
		const embedded = candidate.source_payloads.scorecards[index]; const listed = candidate.scorecard_hashes[index];
		if (embedded === undefined || listed === undefined || embedded.ordinal !== descriptor.ordinal || embedded.phase !== descriptor.phase || embedded.scorecard_id !== descriptor.scorecard_id
			|| listed.ordinal !== descriptor.ordinal || listed.phase !== descriptor.phase || listed.scorecard_id !== descriptor.scorecard_id || listed.scorecard_sha256 !== descriptor.scorecard_sha256) fail("series_artifact_tampered", sourcePath, "Embedded scorecard roster changed");
		if (basename(descriptor.path) !== `${descriptor.scorecard_id}.json`) fail("series_artifact_tampered", sourcePath, "Embedded scorecard path is detached from its declared id");
		const virtualDestination = resolve(virtualRoot, descriptor.path);
		if (!inside(virtualRoot, virtualDestination) || [...destinations].some((existing) => existing === virtualDestination || inside(existing, virtualDestination) || inside(virtualDestination, existing))) fail("series_artifact_tampered", sourcePath, "Embedded scorecard path escapes or collides inside reconstruction root");
		destinations.add(virtualDestination);
		const bytes = decode(embedded.bytes_base64, sourcePath);
		if (hash(bytes) !== descriptor.scorecard_sha256) fail("series_artifact_tampered", sourcePath, "Embedded scorecard hash changed");
		return { descriptor, bytes };
	});
	const root = await mkdtemp(join(tmpdir(), "bc-news-longitudinal-read-")); let cleanupFailure: unknown;
	try {
		for (const { descriptor, bytes } of prepared) {
			const destination = resolve(root, descriptor.path);
			if (!inside(root, destination)) fail("series_artifact_tampered", sourcePath, "Resolved reconstruction destination escaped its isolated root");
			await mkdir(dirname(destination), { recursive: true }); await writeFile(destination, bytes, { flag: "wx" });
		}
		const declarationPath = join(root, "declaration.json"); await writeFile(declarationPath, declarationBytes, { flag: "wx" });
		let loaded;
		try { loaded = await loadEvaluationLongitudinalInput(declarationPath); }
		catch (cause) { return fail("series_artifact_tampered", sourcePath, "Embedded scorecard evidence no longer validates", cause); }
		const rebuilt = buildEvaluationLongitudinalScorecard(loaded, { id: candidate.id, createdAt: candidate.created_at });
		if (!isDeepStrictEqual(rebuilt, candidate)) fail("series_artifact_tampered", sourcePath, "Longitudinal derived evidence does not reconstruct exactly");
		return rebuilt;
	} finally {
		try { await rm(root, { recursive: true }); } catch (cause) { cleanupFailure = cause; }
		if (cleanupFailure !== undefined) fail("series_invalid", sourcePath, `Could not clean longitudinal reconstruction root ${root}`, cleanupFailure);
	}
}

async function validateForCreate(candidate: EvaluationLongitudinalScorecardArtifact, path: string): Promise<EvaluationLongitudinalScorecardArtifact> {
	const result = EvaluationLongitudinalScorecardArtifactSchema.safeParse(candidate);
	if (!result.success) fail("series_create_rejected", path, `Longitudinal artifact contract rejected: ${result.error.message}`, result.error);
	try { return await recompute(result.data, path); }
	catch (cause) { return fail("series_create_rejected", path, "Longitudinal artifact reconstruction failed", cause); }
}

export async function createEvaluationLongitudinalScorecardArtifact(path: string, artifact: EvaluationLongitudinalScorecardArtifact): Promise<EvaluationLongitudinalScorecardArtifact> {
	if (basename(path) !== `${artifact.id}.json`) fail("series_create_rejected", path, "Longitudinal artifact path must use its id as filename");
	const candidate = await validateForCreate(artifact, path);
	try { await writeFile(path, `${JSON.stringify(candidate, null, 2)}\n`, { encoding: "utf8", flag: "wx" }); }
	catch (cause) { return fail("series_create_rejected", path, "Could not exclusively create longitudinal artifact", cause); }
	try { return await loadEvaluationLongitudinalScorecardArtifact(candidate.id, dirname(path)); }
	catch (cause) {
		try { await unlink(path); }
		catch (cleanupCause) { return fail("series_create_rejected", path, "Longitudinal read-after-write failure could not remove the new artifact", cleanupCause); }
		return fail("series_create_rejected", path, "Longitudinal read-after-write validation failed", cause);
	}
}

export async function loadEvaluationLongitudinalScorecardArtifact(id: string, directory: string): Promise<EvaluationLongitudinalScorecardArtifact> {
	const idResult = EvaluationIdSchema.safeParse(id);
	if (!idResult.success) fail("invalid_series_id", directory, `Invalid longitudinal series id: ${id}`, idResult.error);
	const path = join(directory, `${idResult.data}.json`); let raw: Uint8Array;
	try { raw = await readFile(path); }
	catch (cause) { return fail((cause as NodeJS.ErrnoException).code === "ENOENT" ? "series_not_found" : "series_invalid", path, "Cannot read longitudinal artifact", cause); }
	let candidate: unknown;
	try { candidate = JSON.parse(Buffer.from(raw).toString("utf8")) as unknown; }
	catch (cause) { return fail("series_malformed", path, "Malformed longitudinal artifact JSON", cause); }
	const result = EvaluationLongitudinalScorecardArtifactSchema.safeParse(candidate);
	if (!result.success) fail("series_invalid", path, `Longitudinal artifact contract rejected: ${result.error.message}`, result.error);
	let rebuilt: EvaluationLongitudinalScorecardArtifact;
	try { rebuilt = await recompute(result.data, path); }
	catch (cause) {
		if (cause instanceof EvaluationLongitudinalError && cause.code === "series_invalid") throw cause;
		return fail("series_artifact_tampered", path, "Longitudinal artifact source or derivation changed", cause);
	}
	if (!isDeepStrictEqual(rebuilt, result.data)) fail("series_artifact_tampered", path, "Longitudinal artifact does not reconstruct exactly");
	if (rebuilt.id !== idResult.data) fail("series_filename_mismatch", path, "Longitudinal artifact filename identity mismatch");
	return rebuilt;
}
