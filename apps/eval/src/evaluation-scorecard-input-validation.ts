import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { EvidenceFixtureSchema } from "@bc-news/contracts";
import { prepareEvidence } from "@bc-news/generation-core";
import { z } from "zod";
import { canonical, sha256Json } from "./evaluation-artifact-schemas";
import { type V9BenchmarkRun, V9BenchmarkRunSchema } from "./evaluation-artifact";
import { type EvaluationLocalSourceReference } from "./evaluation-local-source-reference";
import {
	type LoadedLocalEvaluationReferenceCorpus,
	type LoadedLocalEvaluationReferenceCorpusEntry,
} from "./evaluation-reference-corpus";
import { evaluationOutputContractProvenance } from "./evaluation-output-contract-provenance";
import {
	AnnotationBundleSchema,
	EvaluationScorecardDeclarationSchema,
	EvaluationScorecardError,
	QualitativeReviewBundleSchema,
	type AnnotationBundle,
	type EvaluationScorecardDeclaration,
	type OutputIdentity,
	type QualitativeReviewBundle,
} from "./evaluation-scorecard";

export type ScorecardBenchmarkRun = V9BenchmarkRun;
type ScorecardTrial = V9BenchmarkRun["trials"][number];
type ScorecardInvocation = ScorecardTrial["invocations"][number];

export type { LoadedLocalEvaluationReferenceCorpus, LoadedLocalEvaluationReferenceCorpusEntry } from "./evaluation-reference-corpus";
export type LoadedEvaluationReferenceCorpusEntry = LoadedLocalEvaluationReferenceCorpusEntry;
export type LoadedEvaluationReferenceCorpus = LoadedLocalEvaluationReferenceCorpus;

export interface LoadedScorecardRun {
	readonly declaration: EvaluationScorecardDeclaration["runs"][number];
	readonly sourceReference: EvaluationLocalSourceReference;
	readonly bytes: Uint8Array;
	readonly run: ScorecardBenchmarkRun;
	readonly corpusEntry: LoadedLocalEvaluationReferenceCorpusEntry;
}

export interface SelectedScorecardOutput {
	readonly identity: OutputIdentity;
	readonly run: LoadedScorecardRun;
	readonly trial: ScorecardTrial;
	readonly invocation: ScorecardInvocation;
	readonly runtime: Extract<ScorecardBenchmarkRun["runtime_evidence"][number], { state: "captured" }>;
}

export interface LoadedEvaluationScorecardInput {
	readonly localDataRoot: string;
	readonly sourceReference: EvaluationLocalSourceReference;
	readonly declarationPath: string;
	readonly declarationBytes: Uint8Array;
	readonly declaration: EvaluationScorecardDeclaration;
	readonly corpus: LoadedLocalEvaluationReferenceCorpus;
	readonly runs: readonly LoadedScorecardRun[];
	readonly annotationBytes: Uint8Array;
	readonly annotations: AnnotationBundle;
	readonly reviewBytes: Uint8Array;
	readonly reviews: QualitativeReviewBundle;
	readonly selectedOutputs: readonly SelectedScorecardOutput[];
}

function fail(code: EvaluationScorecardError["code"], path: string, message: string, cause?: unknown): never {
	throw new EvaluationScorecardError(code, path, message, cause === undefined ? undefined : { cause });
}

function hash(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function sourcePath(reference: EvaluationLocalSourceReference): string {
	return reference.path;
}

function parsed<T>(candidate: unknown, schema: z.ZodType<T>, path: string, code: EvaluationScorecardError["code"]): T {
	const result = schema.safeParse(candidate);
	if (!result.success) return fail(code, path, `Contract rejected ${path}: ${result.error.message}`, result.error);
	return result.data;
}

function unique(values: readonly string[], path: string, code: EvaluationScorecardError["code"], message: string): void {
	if (new Set(values).size !== values.length) fail(code, path, message);
}

function identityKey(identity: OutputIdentity): string {
	return JSON.stringify(identity);
}

function rawJson(raw: Uint8Array, path: string, code: EvaluationScorecardError["code"]): unknown {
	try {
		return JSON.parse(Buffer.from(raw).toString("utf8")) as unknown;
	} catch (cause) {
		return fail(code, path, `Retained JSON is malformed at ${path}`, cause);
	}
}

export function parseEvaluationScorecardBenchmark(
	candidate: unknown,
	expectedId: string,
	expectedConfigIdentity: string,
	path: string,
	expectedRepetitionCount: number | undefined,
): ScorecardBenchmarkRun {
	const result = V9BenchmarkRunSchema.safeParse(candidate);
	if (!result.success) {
		return fail("benchmark_artifact_invalid", path, `Invalid Benchmark Run: ${result.error.message}`, result.error);
	}
	const run = result.data;
	if (run.id !== expectedId) {
		fail("benchmark_filename_mismatch", path, "Benchmark Run filename identity mismatch");
	}
	if (run.lifecycle !== "complete") {
		fail("benchmark_not_complete", path, "Benchmark Run must be complete");
	}
	if (run.harness_outcome !== "retained") {
		fail("benchmark_not_retained", path, "Benchmark Run must be retained");
	}
	const selectedConfigurations = run.declaration.configurations.filter(({ identity }) => identity === expectedConfigIdentity);
	if (selectedConfigurations.length !== 1) {
		fail("configuration_mismatch", path, "Selected Benchmark configuration must occur exactly once");
	}
	if (expectedRepetitionCount !== undefined && run.declaration.repetition_count !== expectedRepetitionCount) {
		fail("repetition_mismatch", path, "Benchmark repetition count changed within the scorecard evidence set");
	}
	if (!isDeepStrictEqual(run.provenance.output_contracts, evaluationOutputContractProvenance())) {
		fail("provenance_mismatch", path, "Benchmark output-contract provenance changed");
	}
	if (
		run.prepared_evidence.identity_sha256 !== sha256Json(run.prepared_evidence.snapshot)
		|| run.prepared_evidence.active_region_id !== run.prepared_evidence.snapshot.active_region_id
		|| run.prepared_evidence.publication_date !== run.prepared_evidence.snapshot.publication_date
		|| run.prepared_evidence.original_count !== run.prepared_evidence.snapshot.raw_count
		|| run.prepared_evidence.final_count !== run.prepared_evidence.snapshot.final_count
	) {
		fail("corpus_binding_mismatch", path, "Prepared-evidence identity or summary is detached from its retained snapshot");
	}
	const roster = run.trial_roster.filter(({ config_identity }) => config_identity === expectedConfigIdentity);
	const trials = run.trials.filter(({ config_identity }) => config_identity === expectedConfigIdentity);
	if (
		roster.length !== run.declaration.repetition_count
		|| trials.length !== roster.length
		|| trials.some((trial, index) =>
			trial.id !== roster[index]?.trial_id
			|| trial.repetition !== roster[index]?.repetition
			|| trial.lifecycle !== "complete")
	) {
		fail("evidence_set_mismatch", path, "Selected trial roster is incomplete or reordered");
	}
	return run;
}

function auditRetainedSources(input: Omit<LoadedEvaluationScorecardInput, "selectedOutputs">): void {
	const declarationFromBytes = parsed(rawJson(input.declarationBytes, input.declarationPath, "invalid_declaration_json"), EvaluationScorecardDeclarationSchema, input.declarationPath, "declaration_rejected");
	if (!isDeepStrictEqual(declarationFromBytes, input.declaration)) fail("declaration_rejected", input.declarationPath, "Parsed declaration is detached from its retained bytes");
	if (!isDeepStrictEqual(input.corpus.sourceReference, input.declaration.corpus.source_reference)) fail("corpus_binding_mismatch", input.corpus.manifestPath, "Corpus source reference is detached from the declaration");
	if (!isDeepStrictEqual(rawJson(input.corpus.manifestBytes, input.corpus.manifestPath, "corpus_binding_mismatch"), input.corpus.manifest)) fail("corpus_binding_mismatch", input.corpus.manifestPath, "Parsed corpus manifest is detached from its retained bytes");
	if (input.runs.length !== input.declaration.runs.length || input.corpus.entries.length !== input.declaration.runs.length || input.corpus.manifest.fixtures.length !== input.declaration.runs.length) fail("evidence_set_mismatch", input.declarationPath, "Loaded runs and corpus entries must match the complete declared roster");
	let repetitionCount: number | undefined;
	for (const [index, declared] of input.declaration.runs.entries()) {
		const loaded = input.runs[index];
		const corpusEntry = input.corpus.entries[index];
		const manifestEntry = input.corpus.manifest.fixtures[index];
		if (loaded === undefined || corpusEntry === undefined || manifestEntry === undefined || !isDeepStrictEqual(loaded.declaration, declared) || !isDeepStrictEqual(loaded.sourceReference, declared.source_reference) || !isDeepStrictEqual(loaded.corpusEntry, corpusEntry) || !isDeepStrictEqual(corpusEntry.manifestEntry, manifestEntry) || declared.corpus_fixture_id !== manifestEntry.id) fail("evidence_set_mismatch", input.declarationPath, `Loaded evidence at ordinal ${String(index + 1)} is reordered or substituted`);
		const fixture = parsed(rawJson(corpusEntry.evidenceBytes, corpusEntry.evidencePath, "corpus_binding_mismatch"), EvidenceFixtureSchema, corpusEntry.evidencePath, "corpus_binding_mismatch");
		if (!isDeepStrictEqual(fixture, corpusEntry.fixture) || !isDeepStrictEqual(rawJson(corpusEntry.referenceBytes, corpusEntry.referencePath, "corpus_binding_mismatch"), corpusEntry.reference)) fail("corpus_binding_mismatch", corpusEntry.referencePath, `Parsed corpus entry ${manifestEntry.id} is detached from retained bytes`);
		const prepared = prepareEvidence({ activeRegionId: fixture.active_region_id, publicationDate: corpusEntry.publicationDate, messages: fixture.messages });
		if (!isDeepStrictEqual(prepared, corpusEntry.preparedEvidence)) fail("corpus_binding_mismatch", corpusEntry.evidencePath, `Prepared corpus entry ${manifestEntry.id} is detached from retained evidence`);
		const runPath = sourcePath(declared.source_reference);
		const runFromBytes = parseEvaluationScorecardBenchmark(rawJson(loaded.bytes, runPath, "benchmark_artifact_malformed"), declared.benchmark_run_id, input.declaration.configuration_identity, runPath, repetitionCount);
		repetitionCount ??= runFromBytes.declaration.repetition_count;
		if (!isDeepStrictEqual(runFromBytes, loaded.run) || loaded.run.id !== declared.benchmark_run_id) fail("evidence_set_mismatch", runPath, "Parsed Benchmark Run is detached from its retained bytes or declared identity");
	}
}

function auditBundleBytes(input: Omit<LoadedEvaluationScorecardInput, "selectedOutputs">): void {
	const annotationPath = sourcePath(input.declaration.annotations.source_reference);
	const reviewPath = sourcePath(input.declaration.qualitative_reviews.source_reference);
	const annotations = parsed(rawJson(input.annotationBytes, annotationPath, "annotation_bundle_rejected"), AnnotationBundleSchema, annotationPath, "annotation_bundle_rejected");
	if (!isDeepStrictEqual(annotations, input.annotations)) fail("annotation_bundle_rejected", annotationPath, "Parsed annotations are detached from retained bytes");
	const reviews = parsed(rawJson(input.reviewBytes, reviewPath, "review_bundle_rejected"), QualitativeReviewBundleSchema, reviewPath, "review_bundle_rejected");
	if (!isDeepStrictEqual(reviews, input.reviews)) fail("review_bundle_rejected", reviewPath, "Parsed reviews are detached from retained bytes");
}

function outputIdentity(loaded: LoadedScorecardRun, trial: ScorecardTrial, invocation: ScorecardInvocation): OutputIdentity {
	if (invocation.transport !== "succeeded" || invocation.parse.state !== "succeeded") throw new Error("Output identity requires parse success");
	if (invocation.completion.text === null) fail("output_identity_mismatch", loaded.declaration.benchmark_run_id, `Parsed invocation ${invocation.id} has no textual completion`);
	const runtime = loaded.run.runtime_evidence.find(({ invocation_id }) => invocation_id === invocation.id);
	if (runtime?.state !== "captured") fail("output_identity_mismatch", loaded.declaration.benchmark_run_id, `Missing captured runtime evidence for ${invocation.id}`);
		const gatewayRequest = loaded.run.gateway_requests.find(({ invocation_id }) => invocation_id === invocation.id);
		if (gatewayRequest === undefined) fail("output_identity_mismatch", loaded.declaration.benchmark_run_id, `Missing Gateway-request evidence for ${invocation.id}`);
		const identity = {
			benchmark_run_id: loaded.run.id,
			benchmark_run_version: 9 as const,
			code_commit_sha: loaded.run.provenance.code.commit_sha,
			prepared_evidence_identity_sha256: loaded.run.prepared_evidence.identity_sha256,
			corpus_manifest_id: "",
		corpus_fixture_id: loaded.declaration.corpus_fixture_id,
		config_identity: trial.config_identity,
		trial_id: trial.id,
		repetition: trial.repetition,
		invocation_id: invocation.id,
		production_step: invocation.production_step,
		invocation_ordinal: invocation.ordinal,
			request_sha256: invocation.request_sha256,
			completion_text_sha256: hash(Buffer.from(invocation.completion.text)),
			parsed_output_sha256: sha256Json(canonical(invocation.parse.output)),
			runtime_evidence_sha256: sha256Json(canonical(runtime.evidence)),
			gateway_request_sha256: sha256Json(canonical(gatewayRequest)),
		};
		return identity;
}

function outputString(output: Record<string, unknown>, pointer: string): string | undefined {
	if (pointer === "") return typeof output === "string" ? output : undefined;
	if (!pointer.startsWith("/")) return undefined;
	let current: unknown = output;
	for (const encoded of pointer.slice(1).split("/")) {
		const key = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
		if (Array.isArray(current) && /^(?:0|[1-9]\d*)$/u.test(key)) current = current[Number(key)];
		else if (current !== null && typeof current === "object" && Object.hasOwn(current, key)) current = (current as Record<string, unknown>)[key];
		else return undefined;
	}
	return typeof current === "string" ? current : undefined;
}

function splitsSurrogate(value: string, offset: number): boolean {
	return offset > 0 && offset < value.length && /[\uD800-\uDBFF]/u.test(value[offset - 1]!) && /[\uDC00-\uDFFF]/u.test(value[offset]!);
}

function spanKey(span: { json_pointer: string; start_utf16: number; end_utf16: number; excerpt: string }): string {
	return JSON.stringify([span.json_pointer, span.start_utf16, span.end_utf16, span.excerpt]);
}

function validateAnnotation(annotation: AnnotationBundle["outputs"][number], output: SelectedScorecardOutput, path: string): void {
	unique(annotation.factual_claims.map(({ id }) => id), path, "annotation_completeness_mismatch", "Claim ids must be unique per output");
	unique(annotation.factual_claims.map(({ proposition }) => proposition.normalize().toLowerCase()), path, "annotation_completeness_mismatch", "Normalized claim propositions must be unique per output");
	for (const claim of annotation.factual_claims) {
		unique(claim.spans.map(spanKey), path, "annotation_completeness_mismatch", `Claim ${claim.id} contains duplicate spans`);
		unique(claim.references.map(({ reference_id }) => reference_id), path, "reference_mismatch", `Claim ${claim.id} repeats a reference`);
	}
	const allSpans = [...annotation.factual_claims.flatMap(({ spans }) => spans), ...annotation.event_coverage.flatMap(({ spans }) => spans)];
	for (const span of allSpans) {
		if (output.invocation.transport !== "succeeded" || output.invocation.parse.state !== "succeeded") throw new Error("Selected output must be parse success");
		const parsedOutput: unknown = output.invocation.parse.output;
		if (parsedOutput === null || typeof parsedOutput !== "object") fail("span_mismatch", path, `Parsed output is not an object for ${output.identity.invocation_id}`);
		const value = outputString(parsedOutput as Record<string, unknown>, span.json_pointer);
		if (value === undefined || span.start_utf16 >= span.end_utf16 || span.end_utf16 > value.length || splitsSurrogate(value, span.start_utf16) || splitsSurrogate(value, span.end_utf16) || value.slice(span.start_utf16, span.end_utf16) !== span.excerpt) fail("span_mismatch", path, `Output span does not bind exact parsed text for ${output.identity.invocation_id}`);
	}
	if (!isDeepStrictEqual(annotation.event_coverage.map(({ event_id }) => event_id), output.run.corpusEntry.reference.events.map(({ id }) => id))) fail("annotation_completeness_mismatch", path, "Event coverage must exactly preserve paired reference order");
	if (output.identity.production_step.startsWith("announcements")) {
		if (annotation.announcement_relevance.state !== "assessed") fail("annotation_completeness_mismatch", path, "Announcement output requires relevance assessment");
	} else if (annotation.announcement_relevance.state !== "not_applicable") fail("annotation_completeness_mismatch", path, "Main-story output cannot assess announcement relevance");
}

export function validateLoadedEvaluationScorecardInput(input: Omit<LoadedEvaluationScorecardInput, "selectedOutputs">): LoadedEvaluationScorecardInput {
	const { declaration, corpus, runs, annotations, reviews, declarationPath } = input;
	auditRetainedSources(input);
	if (declaration.runs.some(({ ordinal }, index) => ordinal !== index + 1)) fail("evidence_set_mismatch", declarationPath, "Run ordinals must be contiguous");
	if (!isDeepStrictEqual(declaration.runs.map(({ corpus_fixture_id }) => corpus_fixture_id), corpus.entries.map(({ manifestEntry }) => manifestEntry.id))) fail("evidence_set_mismatch", declarationPath, "Runs must match the complete corpus manifest in order");
	unique(runs.map(({ run }) => run.id), declarationPath, "evidence_set_mismatch", "Benchmark runs must be unique");
	let repetitionCount: number | undefined;
	let exactConfig: unknown;
	let provenance: unknown;
	const selectedOutputs: SelectedScorecardOutput[] = [];
	for (const loaded of runs) {
		const { run, corpusEntry } = loaded;
		if (run.lifecycle !== "complete") fail("benchmark_not_complete", run.id, "Benchmark Run must be complete");
		if (run.harness_outcome !== "retained") fail("benchmark_not_retained", run.id, "Benchmark Run must be retained");
		if (run.prepared_evidence.identity_sha256 !== sha256Json(corpusEntry.preparedEvidence) || !isDeepStrictEqual(run.prepared_evidence.snapshot, corpusEntry.preparedEvidence)) fail("corpus_binding_mismatch", run.id, "Benchmark prepared evidence does not match corpus entry");
		const declarations = run.declaration.configurations.filter(({ identity }) => identity === declaration.configuration_identity);
		if (declarations.length !== 1) fail("configuration_mismatch", run.id, "Selected configuration must occur exactly once");
		if (exactConfig === undefined) exactConfig = declarations[0]!.config;
		else if (!isDeepStrictEqual(exactConfig, declarations[0]!.config)) fail("configuration_mismatch", run.id, "Selected configuration changed between runs");
		if (repetitionCount === undefined) repetitionCount = run.declaration.repetition_count;
		else if (repetitionCount !== run.declaration.repetition_count) fail("repetition_mismatch", run.id, "Repetition count changed between runs");
		const currentProvenance = { code: run.provenance.code, output_contracts: run.provenance.output_contracts };
		if (provenance === undefined) provenance = currentProvenance;
		else if (!isDeepStrictEqual(provenance, currentProvenance)) fail("provenance_mismatch", run.id, "Code or output-contract provenance changed between runs");
		const roster = run.trial_roster.filter(({ config_identity }) => config_identity === declaration.configuration_identity);
		const trials = run.trials.filter(({ config_identity }) => config_identity === declaration.configuration_identity);
		if (roster.length !== run.declaration.repetition_count || trials.length !== roster.length || trials.some((trial, index) => trial.id !== roster[index]?.trial_id || trial.lifecycle !== "complete")) fail("evidence_set_mismatch", run.id, "Selected trial roster is incomplete or reordered");
		for (const trial of trials) {
			for (const invocation of trial.invocations) {
				if (invocation.transport !== "succeeded" || invocation.parse.state !== "succeeded") continue;
				const identity = outputIdentity(loaded, trial, invocation);
				identity.corpus_manifest_id = corpus.manifest.id;
				const runtime = run.runtime_evidence.find(({ invocation_id }) => invocation_id === invocation.id);
				if (runtime?.state !== "captured") fail("output_identity_mismatch", run.id, `Runtime evidence missing for ${invocation.id}`);
				selectedOutputs.push({ identity, run: loaded, trial, invocation, runtime });
			}
		}
	}
	unique(annotations.outputs.map(({ annotation_id }) => annotation_id), declarationPath, "annotation_completeness_mismatch", "Annotation ids must be unique");
	unique(annotations.outputs.map(({ output }) => identityKey(output)), declarationPath, "annotation_completeness_mismatch", "Annotation output identities must be unique");
	unique(reviews.reviews.map(({ review_id }) => review_id), declarationPath, "review_completeness_mismatch", "Review ids must be unique");
	unique(reviews.reviews.map(({ output }) => identityKey(output)), declarationPath, "review_completeness_mismatch", "Review output identities must be unique");
	const expected = selectedOutputs.map(({ identity }) => identityKey(identity));
	if (annotations.outputs.length !== expected.length) fail("annotation_completeness_mismatch", declarationPath, "Annotations must cover every parse-success output exactly once");
	if (reviews.reviews.length !== expected.length) fail("review_completeness_mismatch", declarationPath, "Reviews must cover every parse-success output exactly once");
	const annotationByOutput = new Map(annotations.outputs.map((annotation) => [identityKey(annotation.output), annotation]));
	const reviewByOutput = new Map(reviews.reviews.map((review) => [identityKey(review.output), review]));
	const orderedAnnotations = expected.map((key) => annotationByOutput.get(key) ?? fail("output_identity_mismatch", declarationPath, "Annotation names a detached output identity"));
	const orderedReviews = expected.map((key) => reviewByOutput.get(key) ?? fail("output_identity_mismatch", declarationPath, "Review names a detached output identity"));
	if (!isDeepStrictEqual(annotations.outputs, orderedAnnotations)) fail("annotation_completeness_mismatch", declarationPath, "Annotations must preserve selected evidence order");
	if (!isDeepStrictEqual(reviews.reviews, orderedReviews)) fail("review_completeness_mismatch", declarationPath, "Reviews must preserve selected evidence order");
	auditBundleBytes(input);
	for (const [index, annotation] of orderedAnnotations.entries()) validateAnnotation(annotation, selectedOutputs[index]!, declarationPath);
	const latest = Math.max(...runs.map(({ run }) => Date.parse(run.completed_at!)));
	if (Date.parse(annotations.annotated_at) < latest || Date.parse(reviews.reviewed_at) < latest) fail("chronology_mismatch", declarationPath, "Annotation and review cannot predate selected Benchmark Runs");
	return { ...input, selectedOutputs };
}
