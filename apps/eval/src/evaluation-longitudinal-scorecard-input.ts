import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { PRODUCTION_MODEL_STEPS, type ProductionModelStep } from "@bc-news/generation-core";
import { projectLongitudinalRoleContext } from "./evaluation-longitudinal-scorecard-builder";
import {
	EvaluationLongitudinalDeclarationSchema, EvaluationLongitudinalError,
	type EvaluationLongitudinalDeclaration, type StableLongitudinalContext,
} from "./evaluation-longitudinal-scorecard";
import {
	AnnotationBundleSchema, EvaluationScorecardArtifactSchema, QualitativeReviewBundleSchema,
	type EvaluationScorecardArtifact,
} from "./evaluation-scorecard";
import { loadEvaluationScorecardArtifact } from "./evaluation-scorecard-store";

const ROLE_ORDER = [...PRODUCTION_MODEL_STEPS];
const RATE_ORDER = ["schema_reliability", "copyedit_preservation", "claim_grounding", "required_attribution", "event_coverage", "announcement_relevance"];
const DISTRIBUTION_ORDER = ["input_tokens", "output_tokens", "total_tokens", "application_latency_ms", "provider_time_to_first_token_ms", "provider_total_time_ms"];
const CRITERION_ORDER = ["coherence", "usefulness", "newsworthiness", "voice"];
const publicReaderAttestations = new WeakMap<LoadedLongitudinalScorecard, string>();

export interface LoadedLongitudinalScorecard {
	readonly descriptor: EvaluationLongitudinalDeclaration["scorecards"][number];
	readonly path: string;
	readonly canonicalPath: string;
	readonly bytes: Uint8Array;
	readonly artifact: EvaluationScorecardArtifact;
	readonly annotationProvenance: { readonly annotatorId: string; readonly annotatedAt: string; readonly reviewerId: string; readonly reviewedAt: string };
}
export interface LoadedEvaluationLongitudinalInput {
	readonly declarationPath: string;
	readonly declarationBytes: Uint8Array;
	readonly declaration: EvaluationLongitudinalDeclaration;
	readonly scorecards: readonly LoadedLongitudinalScorecard[];
	readonly stableRoleContexts: readonly Readonly<Record<ProductionModelStep, StableLongitudinalContext>>[];
}

function fail(code: EvaluationLongitudinalError["code"], path: string, message: string, cause?: unknown): never {
	throw new EvaluationLongitudinalError(code, path, message, cause === undefined ? undefined : { cause });
}
function hash(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
function parseJson(bytes: Uint8Array, path: string, code: "invalid_longitudinal_declaration_json" | "scorecard_source_malformed"): unknown {
	try { return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown; }
	catch (cause) { return fail(code, path, `Malformed JSON at ${path}`, cause); }
}
function decodeCanonical(encoded: string, path: string): Uint8Array {
	const decoded = Buffer.from(encoded, "base64");
	if (decoded.toString("base64") !== encoded) fail("scorecard_source_invalid", path, "Scorecard contains noncanonical embedded base64");
	return decoded;
}
function provenance(artifact: EvaluationScorecardArtifact, path: string): LoadedLongitudinalScorecard["annotationProvenance"] {
	const annotationResult = AnnotationBundleSchema.safeParse(parseJson(decodeCanonical(artifact.source_payloads.annotation_bundle_base64, path), path, "scorecard_source_malformed"));
	const reviewResult = QualitativeReviewBundleSchema.safeParse(parseJson(decodeCanonical(artifact.source_payloads.qualitative_review_bundle_base64, path), path, "scorecard_source_malformed"));
	if (!annotationResult.success || !reviewResult.success) fail("scorecard_source_invalid", path, "Scorecard human-evidence provenance is invalid");
	return { annotatorId: annotationResult.data.annotator.id, annotatedAt: annotationResult.data.annotated_at, reviewerId: reviewResult.data.reviewer.id, reviewedAt: reviewResult.data.reviewed_at };
}
function exactOrder(actual: readonly string[], expected: readonly string[]): boolean { return actual.length === expected.length && actual.every((value, index) => value === expected[index]); }
function sourceAttestation(source: LoadedLongitudinalScorecard): string {
	return createHash("sha256").update(JSON.stringify({
		descriptor: source.descriptor, path: source.path, canonicalPath: source.canonicalPath,
		bytesSha256: hash(source.bytes), artifact: source.artifact, annotationProvenance: source.annotationProvenance,
	})).digest("hex");
}
function validateRoleContracts(artifact: EvaluationScorecardArtifact, path: string): void {
	if (!exactOrder(artifact.scorecards.map(({ production_step }) => production_step), ROLE_ORDER)) fail("longitudinal_evidence_set_mismatch", path, "Scorecard role roster changed");
	for (const role of artifact.scorecards) {
		if (!exactOrder(role.rates.map(({ metric }) => metric), RATE_ORDER)
			|| !exactOrder(role.distributions.map(({ metric }) => metric), DISTRIBUTION_ORDER)
			|| !exactOrder(role.qualitative.map(({ criterion }) => criterion), CRITERION_ORDER)) {
			fail("longitudinal_evidence_set_mismatch", path, `Scorecard metric roster changed for ${role.production_step}`);
		}
	}
}
function inside(root: string, target: string): boolean { const fromRoot = relative(root, target); return fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot); }

function auditLoaded(input: Omit<LoadedEvaluationLongitudinalInput, "stableRoleContexts">): void {
	const parsedDeclaration = EvaluationLongitudinalDeclarationSchema.safeParse(parseJson(input.declarationBytes, input.declarationPath, "invalid_longitudinal_declaration_json"));
	if (!parsedDeclaration.success || !isDeepStrictEqual(parsedDeclaration.data, input.declaration)) fail("longitudinal_declaration_rejected", input.declarationPath, "Parsed declaration is detached from retained bytes");
	if (input.scorecards.length !== input.declaration.scorecards.length) fail("longitudinal_evidence_set_mismatch", input.declarationPath, "Loaded scorecards do not match the complete declaration roster");
	const runIds = new Set<string>(); const runHashes = new Set<string>(); let previousTime = Number.NEGATIVE_INFINITY; let latestBaseline = Number.NEGATIVE_INFINITY; let earliestSubject = Number.POSITIVE_INFINITY;
	for (const [index, descriptor] of input.declaration.scorecards.entries()) {
		const loaded = input.scorecards[index];
		if (loaded === undefined || !isDeepStrictEqual(loaded.descriptor, descriptor)) fail("longitudinal_evidence_set_mismatch", input.declarationPath, `Loaded scorecard ${String(index + 1)} is reordered or substituted`);
		const expectedPath = join(dirname(input.declarationPath), descriptor.path);
		if (resolve(loaded.path) !== resolve(expectedPath) || basename(loaded.path) !== `${descriptor.scorecard_id}.json` || loaded.artifact.id !== descriptor.scorecard_id) fail("longitudinal_evidence_set_mismatch", loaded.path, "Loaded scorecard identity or path attachment changed");
		if (hash(loaded.bytes) !== descriptor.scorecard_sha256) fail("longitudinal_evidence_set_mismatch", loaded.path, "Loaded scorecard bytes changed");
		let parsed: unknown; try { parsed = JSON.parse(Buffer.from(loaded.bytes).toString("utf8")) as unknown; } catch (cause) { return fail("longitudinal_evidence_set_mismatch", loaded.path, "Loaded scorecard bytes became malformed", cause); }
		const artifactResult = EvaluationScorecardArtifactSchema.safeParse(parsed);
		if (!artifactResult.success || !isDeepStrictEqual(artifactResult.data, loaded.artifact)) fail("longitudinal_evidence_set_mismatch", loaded.path, "Parsed scorecard is detached from retained bytes");
		let expectedProvenance: LoadedLongitudinalScorecard["annotationProvenance"];
		try { expectedProvenance = provenance(loaded.artifact, loaded.path); }
		catch (cause) { return fail("longitudinal_evidence_set_mismatch", loaded.path, "Loaded human-evidence provenance no longer reconstructs", cause); }
		if (!isDeepStrictEqual(expectedProvenance, loaded.annotationProvenance)) fail("longitudinal_evidence_set_mismatch", loaded.path, "Loaded human-evidence provenance is detached");
		if (publicReaderAttestations.get(loaded) !== sourceAttestation(loaded)) fail("longitudinal_evidence_set_mismatch", loaded.path, "Loaded scorecard lacks exact public-reader reconstruction evidence");
		validateRoleContracts(loaded.artifact, loaded.path);
		const time = Date.parse(loaded.artifact.created_at);
		if (time <= previousTime) fail("longitudinal_chronology_mismatch", loaded.path, "Scorecard creation times must strictly increase");
		previousTime = time;
		if (descriptor.phase === "baseline") latestBaseline = Math.max(latestBaseline, time); else earliestSubject = Math.min(earliestSubject, time);
		for (const run of loaded.artifact.benchmark_run_hashes) {
			if (runIds.has(run.benchmark_run_id) || runHashes.has(run.benchmark_run_sha256)) fail("longitudinal_evidence_set_mismatch", loaded.path, "Underlying Benchmark Run rosters must be pairwise disjoint");
			runIds.add(run.benchmark_run_id); runHashes.add(run.benchmark_run_sha256);
		}
	}
	if (!(latestBaseline < earliestSubject)) fail("longitudinal_chronology_mismatch", input.declarationPath, "Every baseline scorecard must predate every subject scorecard");
}

export function validateLoadedEvaluationLongitudinalInput(input: Omit<LoadedEvaluationLongitudinalInput, "stableRoleContexts">): LoadedEvaluationLongitudinalInput {
	auditLoaded(input);
	return { ...input, stableRoleContexts: input.scorecards.map(({ artifact }) => Object.fromEntries(PRODUCTION_MODEL_STEPS.map((step) => [step, projectLongitudinalRoleContext(artifact, step)])) as Record<ProductionModelStep, StableLongitudinalContext>) };
}

export async function loadEvaluationLongitudinalInput(declarationPath: string): Promise<LoadedEvaluationLongitudinalInput> {
	const absolute = resolve(declarationPath); let declarationBytes: Uint8Array;
	try { declarationBytes = await readFile(absolute); } catch (cause) { return fail("scorecard_source_unreadable", absolute, "Cannot read longitudinal declaration", cause); }
	const declarationResult = EvaluationLongitudinalDeclarationSchema.safeParse(parseJson(declarationBytes, absolute, "invalid_longitudinal_declaration_json"));
	if (!declarationResult.success) fail("longitudinal_declaration_rejected", absolute, `Longitudinal declaration rejected: ${declarationResult.error.message}`, declarationResult.error);
	const declaration = declarationResult.data;
	let canonicalRoot: string; try { canonicalRoot = await realpath(dirname(absolute)); } catch (cause) { return fail("longitudinal_declaration_rejected", absolute, "Cannot resolve declaration root", cause); }
	const normalizedTargets = new Set<string>(); const canonicalTargets = new Set<string>(); const scorecards: LoadedLongitudinalScorecard[] = [];
	for (const descriptor of declaration.scorecards) {
		const path = join(dirname(absolute), descriptor.path); const normalizedTarget = resolve(path);
		if (!inside(resolve(dirname(absolute)), normalizedTarget) || normalizedTargets.has(normalizedTarget)) fail("longitudinal_declaration_rejected", absolute, `Scorecard path escapes or aliases declaration root: ${descriptor.path}`);
		normalizedTargets.add(normalizedTarget);
		if (basename(path) !== `${descriptor.scorecard_id}.json`) fail("scorecard_source_filename_mismatch", path, "Scorecard source filename must match declared id");
		let canonicalPath: string; try { canonicalPath = await realpath(path); } catch (cause) { return fail("scorecard_source_unreadable", path, "Cannot read named scorecard source", cause); }
		if (!inside(canonicalRoot, canonicalPath) || canonicalTargets.has(canonicalPath)) fail("longitudinal_declaration_rejected", absolute, `Scorecard canonical path escapes or aliases declaration root: ${descriptor.path}`);
		canonicalTargets.add(canonicalPath);
		let bytes: Uint8Array; try { bytes = await readFile(path); } catch (cause) { return fail("scorecard_source_unreadable", path, "Cannot read named scorecard source", cause); }
		if (hash(bytes) !== descriptor.scorecard_sha256) fail("scorecard_source_hash_mismatch", path, "Scorecard source byte hash mismatch");
		const artifactResult = EvaluationScorecardArtifactSchema.safeParse(parseJson(bytes, path, "scorecard_source_malformed"));
		if (!artifactResult.success) fail("scorecard_source_invalid", path, `Scorecard source contract rejected: ${artifactResult.error.message}`, artifactResult.error);
		if (artifactResult.data.id !== descriptor.scorecard_id) fail("scorecard_source_filename_mismatch", path, "Parsed and declared scorecard ids differ");
		let artifact: EvaluationScorecardArtifact;
		try { artifact = await loadEvaluationScorecardArtifact(descriptor.scorecard_id, dirname(path)); }
		catch (cause) { return fail("scorecard_source_invalid", path, "Scorecard source does not reconstruct", cause); }
		if (!isDeepStrictEqual(artifact, artifactResult.data)) fail("scorecard_source_invalid", path, "Public scorecard reader returned detached evidence");
		const loaded = { descriptor, path, canonicalPath, bytes, artifact, annotationProvenance: provenance(artifact, path) };
		publicReaderAttestations.set(loaded, sourceAttestation(loaded));
		scorecards.push(loaded);
	}
	return validateLoadedEvaluationLongitudinalInput({ declarationPath: absolute, declarationBytes, declaration, scorecards });
}
