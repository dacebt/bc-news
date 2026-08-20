import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
	CURRENT_PRODUCTION_MODEL_STEPS as PRODUCTION_MODEL_STEPS,
	type CurrentProductionModelStep as ProductionModelStep,
} from "./current-production-steps";
import { projectLongitudinalRoleContext } from "./evaluation-longitudinal-scorecard-builder";
import {
	EvaluationLongitudinalDeclarationSchema,
	EvaluationLongitudinalError,
	LocalSourceReferenceSchema,
	type EvaluationLongitudinalDeclaration,
	type LocalSourceReference,
	type StableLongitudinalContext,
} from "./evaluation-longitudinal-scorecard";
import { EvaluationScorecardArtifactSchema, type EvaluationScorecardArtifact } from "./evaluation-scorecard";
import { validateEvaluationScorecardArtifact } from "./evaluation-scorecard-store";

const ROLE_ORDER = [...PRODUCTION_MODEL_STEPS];
const RATE_ORDER = ["schema_reliability", "claim_grounding", "required_attribution", "event_coverage", "announcement_relevance"];
const DISTRIBUTION_ORDER = ["input_tokens", "output_tokens", "total_tokens", "application_latency_ms", "provider_time_to_first_token_ms", "provider_total_time_ms"];
const CRITERION_ORDER = ["coherence", "usefulness", "newsworthiness", "voice"];
const readerAttestations = new WeakMap<LoadedLongitudinalScorecard, string>();

export interface LoadedLongitudinalScorecard {
	readonly descriptor: EvaluationLongitudinalDeclaration["scorecards"][number];
	readonly bytes: Uint8Array;
	readonly artifact: EvaluationScorecardArtifact;
	readonly annotationProvenance: { readonly annotatorId: string; readonly annotatedAt: string; readonly reviewerId: string; readonly reviewedAt: string };
}

export interface LoadedEvaluationLongitudinalInput {
	readonly localDataRoot: string;
	readonly sourceReference: LocalSourceReference;
	readonly declarationPath: string;
	readonly declarationBytes: Uint8Array;
	readonly declaration: EvaluationLongitudinalDeclaration;
	readonly scorecards: readonly LoadedLongitudinalScorecard[];
	readonly stableRoleContexts: readonly Readonly<Record<ProductionModelStep, StableLongitudinalContext>>[];
}

function fail(code: EvaluationLongitudinalError["code"], path: string, message: string, cause?: unknown): never {
	throw new EvaluationLongitudinalError(code, path, message, cause === undefined ? undefined : { cause });
}

function parseJson(bytes: Uint8Array, path: string, code: "invalid_longitudinal_declaration_json" | "scorecard_source_malformed"): unknown {
	try { return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown; }
	catch (cause) { return fail(code, path, `Malformed JSON at ${path}`, cause); }
}

function exactOrder(actual: readonly string[], expected: readonly string[]): boolean {
	return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function hash(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function sourceAttestation(source: LoadedLongitudinalScorecard): string {
	return hash(Buffer.from(JSON.stringify({ descriptor: source.descriptor, artifact: source.artifact, annotationProvenance: source.annotationProvenance })));
}

async function containedLocalPath(localDataRoot: string, sourcePath: string): Promise<string> {
	const root = await realpath(resolve(localDataRoot));
	const absolute = resolve(root, sourcePath);
	const actual = await realpath(absolute).catch((cause) => fail("scorecard_source_unreadable", sourcePath, "Cannot resolve local evidence source", cause));
	const contained = relative(root, actual).split(sep).join("/");
	const parsed = LocalSourceReferenceSchema.shape.path.safeParse(contained);
	if (!parsed.success) fail("scorecard_source_unreadable", sourcePath, "Local evidence source escapes the local-data root", parsed.error);
	return actual;
}

async function readLocalSource(localDataRoot: string, sourceReference: LocalSourceReference): Promise<Uint8Array> {
	const parsed = LocalSourceReferenceSchema.safeParse(sourceReference);
	if (!parsed.success) fail("scorecard_source_unreadable", sourceReference.path, "Invalid local source reference", parsed.error);
	const actual = await containedLocalPath(localDataRoot, parsed.data.path);
	const bytes = await readFile(actual).catch((cause) => fail("scorecard_source_unreadable", parsed.data.path, "Cannot read local evidence source", cause));
	if (hash(bytes) !== parsed.data.sha256) fail("scorecard_source_hash_mismatch", parsed.data.path, "Local evidence source hash mismatch");
	return bytes;
}

export async function localSourceReferenceAtPath(localDataRoot: string, sourcePath: string): Promise<LocalSourceReference> {
	const root = await realpath(resolve(localDataRoot));
	const actual = await containedLocalPath(root, sourcePath);
	const bytes = await readFile(actual).catch((cause) => fail("scorecard_source_unreadable", sourcePath, "Cannot read local evidence source", cause));
	const relativePath = relative(root, actual).split(sep).join("/");
	const parsedPath = LocalSourceReferenceSchema.shape.path.safeParse(relativePath);
	if (!parsedPath.success) fail("scorecard_source_unreadable", sourcePath, "Local evidence source escapes the local-data root", parsedPath.error);
	return { path: parsedPath.data, sha256: hash(bytes) };
}

function validateRoleContracts(artifact: EvaluationScorecardArtifact, path: string): void {
	if (artifact.version !== 4) fail("scorecard_source_invalid", path, "Longitudinal V4 accepts only scorecard V4 sources");
	if (!exactOrder(artifact.scorecards.map(({ production_step }) => production_step), ROLE_ORDER)) fail("longitudinal_evidence_set_mismatch", path, "Scorecard role roster changed");
	for (const role of artifact.scorecards) {
		if (!exactOrder(role.rates.map(({ metric }) => metric), RATE_ORDER)
			|| !exactOrder(role.distributions.map(({ metric }) => metric), DISTRIBUTION_ORDER)
			|| !exactOrder(role.qualitative.map(({ criterion }) => criterion), CRITERION_ORDER)) fail("longitudinal_evidence_set_mismatch", path, `Scorecard metric roster changed for ${role.production_step}`);
	}
}

function provenance(artifact: EvaluationScorecardArtifact): LoadedLongitudinalScorecard["annotationProvenance"] {
	return {
		annotatorId: artifact.sources.annotations.annotator_id,
		annotatedAt: artifact.sources.annotations.annotated_at,
		reviewerId: artifact.sources.qualitative_reviews.reviewer_id,
		reviewedAt: artifact.sources.qualitative_reviews.reviewed_at,
	};
}

function auditLoaded(input: Omit<LoadedEvaluationLongitudinalInput, "stableRoleContexts">): void {
	const parsedDeclaration = EvaluationLongitudinalDeclarationSchema.safeParse(parseJson(input.declarationBytes, input.declarationPath, "invalid_longitudinal_declaration_json"));
	if (!parsedDeclaration.success || !isDeepStrictEqual(parsedDeclaration.data, input.declaration)) fail("longitudinal_declaration_rejected", input.declarationPath, "Parsed declaration is detached from retained bytes");
	if (input.scorecards.length !== input.declaration.scorecards.length) fail("longitudinal_evidence_set_mismatch", input.declarationPath, "Loaded scorecards do not match the complete declaration roster");
	const runIds = new Set<string>(); let previousTime = Number.NEGATIVE_INFINITY; let latestBaseline = Number.NEGATIVE_INFINITY; let earliestSubject = Number.POSITIVE_INFINITY;
	for (const [index, descriptor] of input.declaration.scorecards.entries()) {
		const loaded = input.scorecards[index];
		if (loaded === undefined || !isDeepStrictEqual(loaded.descriptor, descriptor) || loaded.artifact.id !== descriptor.scorecard_id) fail("longitudinal_evidence_set_mismatch", input.declarationPath, `Loaded scorecard ${String(index + 1)} is reordered or substituted`);
		const parsed = EvaluationScorecardArtifactSchema.safeParse(parseJson(loaded.bytes, descriptor.source_reference.path, "scorecard_source_malformed"));
		if (!parsed.success || !isDeepStrictEqual(parsed.data, loaded.artifact)) fail("longitudinal_evidence_set_mismatch", descriptor.source_reference.path, "Parsed scorecard is detached from retained bytes");
		if (!isDeepStrictEqual(provenance(loaded.artifact), loaded.annotationProvenance)) fail("longitudinal_evidence_set_mismatch", descriptor.source_reference.path, "Codex provenance is detached");
		if (readerAttestations.get(loaded) !== sourceAttestation(loaded)) fail("longitudinal_evidence_set_mismatch", descriptor.source_reference.path, "Loaded scorecard lacks public-reader reconstruction evidence");
		validateRoleContracts(loaded.artifact, descriptor.source_reference.path);
		const time = Date.parse(loaded.artifact.created_at);
		if (time <= previousTime) fail("longitudinal_chronology_mismatch", descriptor.source_reference.path, "Scorecard creation times must strictly increase");
		previousTime = time;
		if (descriptor.phase === "baseline") latestBaseline = Math.max(latestBaseline, time); else earliestSubject = Math.min(earliestSubject, time);
		for (const run of loaded.artifact.sources.benchmark_runs) {
			if (runIds.has(run.benchmark_run_id)) fail("longitudinal_evidence_set_mismatch", descriptor.source_reference.path, "Underlying Benchmark Run ids must be pairwise disjoint");
			runIds.add(run.benchmark_run_id);
		}
	}
	if (!(latestBaseline < earliestSubject)) fail("longitudinal_chronology_mismatch", input.declarationPath, "Every baseline scorecard must predate every subject scorecard");
}

export function validateLoadedEvaluationLongitudinalInput(input: Omit<LoadedEvaluationLongitudinalInput, "stableRoleContexts">): LoadedEvaluationLongitudinalInput {
	auditLoaded(input);
	return { ...input, stableRoleContexts: input.scorecards.map(({ artifact }) => Object.fromEntries(PRODUCTION_MODEL_STEPS.map((step) => [step, projectLongitudinalRoleContext(artifact, step)])) as Record<ProductionModelStep, StableLongitudinalContext>) };
}

export async function loadEvaluationLongitudinalInputAtReference(localDataRoot: string, sourceReference: LocalSourceReference): Promise<LoadedEvaluationLongitudinalInput> {
	const declarationBytes = await readLocalSource(localDataRoot, sourceReference);
	const declarationResult = EvaluationLongitudinalDeclarationSchema.safeParse(parseJson(declarationBytes, sourceReference.path, "invalid_longitudinal_declaration_json"));
	if (!declarationResult.success) fail("longitudinal_declaration_rejected", sourceReference.path, `Longitudinal declaration rejected: ${declarationResult.error.message}`, declarationResult.error);
	const declaration = declarationResult.data;
	const scorecards: LoadedLongitudinalScorecard[] = [];
	for (const descriptor of declaration.scorecards) {
		const bytes = await readLocalSource(localDataRoot, descriptor.source_reference);
		const artifactResult = EvaluationScorecardArtifactSchema.safeParse(parseJson(bytes, descriptor.source_reference.path, "scorecard_source_malformed"));
		if (!artifactResult.success) fail("scorecard_source_invalid", descriptor.source_reference.path, `Scorecard source contract rejected: ${artifactResult.error.message}`, artifactResult.error);
		if (artifactResult.data.id !== descriptor.scorecard_id) fail("scorecard_source_filename_mismatch", descriptor.source_reference.path, "Parsed and declared scorecard ids differ");
		const artifact = await validateEvaluationScorecardArtifact(artifactResult.data, descriptor.source_reference.path, { localDataRoot }) as EvaluationScorecardArtifact;
		validateRoleContracts(artifact, descriptor.source_reference.path);
		const loaded = { descriptor, bytes, artifact, annotationProvenance: provenance(artifact) };
		readerAttestations.set(loaded, sourceAttestation(loaded));
		scorecards.push(loaded);
	}
	return validateLoadedEvaluationLongitudinalInput({ localDataRoot, sourceReference, declarationPath: sourceReference.path, declarationBytes, declaration, scorecards });
}

export async function loadEvaluationLongitudinalInput(declarationPath: string, localDataRoot: string): Promise<LoadedEvaluationLongitudinalInput> {
	return loadEvaluationLongitudinalInputAtReference(localDataRoot, await localSourceReferenceAtPath(localDataRoot, declarationPath));
}
