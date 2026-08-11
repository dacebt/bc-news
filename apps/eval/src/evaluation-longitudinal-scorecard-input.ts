import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { PRODUCTION_MODEL_STEPS, type ProductionModelStep } from "@bc-news/generation-core";
import { projectLongitudinalRoleContext } from "./evaluation-longitudinal-scorecard-builder";
import {
	EvaluationLongitudinalDeclarationSchema,
	EvaluationLongitudinalError,
	type EvaluationLongitudinalDeclaration,
	type StableLongitudinalContext,
} from "./evaluation-longitudinal-scorecard";
import { EvaluationScorecardArtifactSchema, type EvaluationScorecardArtifact } from "./evaluation-scorecard";
import { validateEvaluationScorecardArtifactV2 } from "./evaluation-scorecard-store";
import { readRepositorySource, sourceReferenceAtHead, type RepositorySourceReference } from "./evaluation-repository-reference";

const ROLE_ORDER = [...PRODUCTION_MODEL_STEPS];
const RATE_ORDER = ["schema_reliability", "copyedit_preservation", "claim_grounding", "required_attribution", "event_coverage", "announcement_relevance"];
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
	readonly repositoryRoot: string;
	readonly sourceReference: RepositorySourceReference;
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

function sourceAttestation(source: LoadedLongitudinalScorecard): string {
	return createHash("sha256").update(JSON.stringify({ descriptor: source.descriptor, artifact: source.artifact, annotationProvenance: source.annotationProvenance })).digest("hex");
}

function validateRoleContracts(artifact: EvaluationScorecardArtifact, path: string): void {
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
		if (!parsed.success || !isDeepStrictEqual(parsed.data, loaded.artifact)) fail("longitudinal_evidence_set_mismatch", descriptor.source_reference.path, "Parsed scorecard is detached from retained commit bytes");
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

export async function loadEvaluationLongitudinalInputAtReference(repositoryRoot: string, sourceReference: RepositorySourceReference): Promise<LoadedEvaluationLongitudinalInput> {
	let declarationBytes: Uint8Array;
	try { declarationBytes = await readRepositorySource(repositoryRoot, sourceReference); }
	catch (cause) { return fail("scorecard_source_unreadable", sourceReference.path, "Cannot read longitudinal declaration", cause); }
	const declarationResult = EvaluationLongitudinalDeclarationSchema.safeParse(parseJson(declarationBytes, sourceReference.path, "invalid_longitudinal_declaration_json"));
	if (!declarationResult.success) fail("longitudinal_declaration_rejected", sourceReference.path, `Longitudinal declaration rejected: ${declarationResult.error.message}`, declarationResult.error);
	const declaration = declarationResult.data;
	const scorecards: LoadedLongitudinalScorecard[] = [];
	for (const descriptor of declaration.scorecards) {
		let bytes: Uint8Array;
		try { bytes = await readRepositorySource(repositoryRoot, descriptor.source_reference); }
		catch (cause) { return fail("scorecard_source_unreadable", descriptor.source_reference.path, "Cannot read named scorecard source", cause); }
		const artifactResult = EvaluationScorecardArtifactSchema.safeParse(parseJson(bytes, descriptor.source_reference.path, "scorecard_source_malformed"));
		if (!artifactResult.success) fail("scorecard_source_invalid", descriptor.source_reference.path, `Scorecard source contract rejected: ${artifactResult.error.message}`, artifactResult.error);
		if (artifactResult.data.id !== descriptor.scorecard_id) fail("scorecard_source_filename_mismatch", descriptor.source_reference.path, "Parsed and declared scorecard ids differ");
		let artifact: EvaluationScorecardArtifact;
		try { artifact = await validateEvaluationScorecardArtifactV2(artifactResult.data, descriptor.source_reference.path, repositoryRoot); }
		catch (cause) { return fail("scorecard_source_invalid", descriptor.source_reference.path, "Scorecard source does not reconstruct", cause); }
		const loaded = { descriptor, bytes, artifact, annotationProvenance: provenance(artifact) };
		readerAttestations.set(loaded, sourceAttestation(loaded));
		scorecards.push(loaded);
	}
	return validateLoadedEvaluationLongitudinalInput({ repositoryRoot, sourceReference, declarationPath: sourceReference.path, declarationBytes, declaration, scorecards });
}

export async function loadEvaluationLongitudinalInput(declarationPath: string, repositoryRoot: string): Promise<LoadedEvaluationLongitudinalInput> {
	return loadEvaluationLongitudinalInputAtReference(repositoryRoot, await sourceReferenceAtHead(repositoryRoot, declarationPath));
}
