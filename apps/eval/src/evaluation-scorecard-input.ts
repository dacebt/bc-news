import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { EvidenceFixtureSchema } from "@bc-news/contracts";
import { prepareEvidence } from "@bc-news/generation-core";
import { z } from "zod";
import { BenchmarkRunSchema } from "./evaluation-artifact";
import { canonical, evaluationConfigIdentity, sha256Json } from "./evaluation-artifact-schemas";
import { V7BenchmarkRunBaseSchema, V7BenchmarkRunSchema, type V7BenchmarkRun } from "./evaluation-artifact-v7";
import { v1OutputContractProvenance } from "./evaluation-artifact-v1-contracts";
import { EvaluationReferenceCorpusError, loadEvaluationReferenceCorpus, type LoadedEvaluationReferenceCorpus, type LoadedEvaluationReferenceCorpusEntry } from "./evaluation-reference-corpus";
import {
	AnnotationBundleSchema, EvaluationScorecardDeclarationSchema, EvaluationScorecardError,
	QualitativeReviewBundleSchema, type AnnotationBundle, type EvaluationScorecardDeclaration,
	type OutputIdentity, type QualitativeReviewBundle,
} from "./evaluation-scorecard";

export interface LoadedScorecardRun { readonly declaration: EvaluationScorecardDeclaration["runs"][number]; readonly bytes: Uint8Array; readonly run: V7BenchmarkRun; readonly corpusEntry: LoadedEvaluationReferenceCorpusEntry }
export interface SelectedScorecardOutput { readonly identity: OutputIdentity; readonly run: LoadedScorecardRun; readonly trial: V7BenchmarkRun["trials"][number]; readonly invocation: V7BenchmarkRun["trials"][number]["invocations"][number]; readonly runtime: Extract<V7BenchmarkRun["runtime_evidence"][number], { state: "captured" }> }
export interface LoadedEvaluationScorecardInput {
	readonly declarationPath: string; readonly declarationBytes: Uint8Array; readonly declaration: EvaluationScorecardDeclaration;
	readonly corpus: LoadedEvaluationReferenceCorpus; readonly runs: readonly LoadedScorecardRun[];
	readonly annotationBytes: Uint8Array; readonly annotations: AnnotationBundle;
	readonly reviewBytes: Uint8Array; readonly reviews: QualitativeReviewBundle;
	readonly selectedOutputs: readonly SelectedScorecardOutput[];
}

function fail(code: EvaluationScorecardError["code"], path: string, message: string, cause?: unknown): never {
	throw new EvaluationScorecardError(code, path, message, cause === undefined ? undefined : { cause });
}
function hash(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
async function bytes(path: string): Promise<Uint8Array> {
	try { return await readFile(path); } catch (cause) { return fail("source_unreadable", path, `Cannot read scorecard source ${path}`, cause); }
}
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
function identityKey(identity: OutputIdentity): string { return JSON.stringify(identity); }
function rawJson(raw: Uint8Array, path: string, code: EvaluationScorecardError["code"]): unknown {
	try { return JSON.parse(Buffer.from(raw).toString("utf8")) as unknown; }
	catch (cause) { return fail(code, path, `Retained JSON is malformed at ${path}`, cause); }
}
function auditRetainedSources(input: Omit<LoadedEvaluationScorecardInput, "selectedOutputs">): void {
	const declarationFromBytes = parsed(rawJson(input.declarationBytes, input.declarationPath, "invalid_declaration_json"), EvaluationScorecardDeclarationSchema, input.declarationPath, "declaration_rejected");
	if (!isDeepStrictEqual(declarationFromBytes, input.declaration)) fail("declaration_rejected", input.declarationPath, "Parsed declaration is detached from its retained bytes");
	if (hash(input.corpus.manifestBytes) !== input.corpus.manifestSha256 || input.corpus.manifestSha256 !== input.declaration.corpus.manifest_sha256) fail("source_hash_mismatch", input.corpus.manifestPath, "Corpus manifest byte hash mismatch");
	if (!isDeepStrictEqual(rawJson(input.corpus.manifestBytes, input.corpus.manifestPath, "corpus_binding_mismatch"), input.corpus.manifest)) fail("corpus_binding_mismatch", input.corpus.manifestPath, "Parsed corpus manifest is detached from its retained bytes");
	if (input.runs.length !== input.declaration.runs.length || input.corpus.entries.length !== input.declaration.runs.length || input.corpus.manifest.fixtures.length !== input.declaration.runs.length) fail("evidence_set_mismatch", input.declarationPath, "Loaded runs and corpus entries must match the complete declared roster");
	let repetitionCount: number | undefined;
	for (const [index, declared] of input.declaration.runs.entries()) {
		const loaded = input.runs[index]; const corpusEntry = input.corpus.entries[index]; const manifestEntry = input.corpus.manifest.fixtures[index];
		if (loaded === undefined || corpusEntry === undefined || manifestEntry === undefined || !isDeepStrictEqual(loaded.declaration, declared) || !isDeepStrictEqual(loaded.corpusEntry, corpusEntry) || !isDeepStrictEqual(corpusEntry.manifestEntry, manifestEntry) || declared.corpus_fixture_id !== manifestEntry.id) fail("evidence_set_mismatch", input.declarationPath, `Loaded evidence at ordinal ${String(index + 1)} is reordered or substituted`);
		if (hash(corpusEntry.evidenceBytes) !== manifestEntry.evidence_sha256 || hash(corpusEntry.referenceBytes) !== manifestEntry.reference_sha256) fail("source_hash_mismatch", corpusEntry.evidencePath, `Corpus entry ${manifestEntry.id} byte hash mismatch`);
		const fixture = parsed(rawJson(corpusEntry.evidenceBytes, corpusEntry.evidencePath, "corpus_binding_mismatch"), EvidenceFixtureSchema, corpusEntry.evidencePath, "corpus_binding_mismatch");
		if (!isDeepStrictEqual(fixture, corpusEntry.fixture) || !isDeepStrictEqual(rawJson(corpusEntry.referenceBytes, corpusEntry.referencePath, "corpus_binding_mismatch"), corpusEntry.reference)) fail("corpus_binding_mismatch", corpusEntry.referencePath, `Parsed corpus entry ${manifestEntry.id} is detached from retained bytes`);
		const prepared = prepareEvidence({ activeRegionId: fixture.active_region_id, publicationDate: corpusEntry.publicationDate, messages: fixture.messages });
		if (!isDeepStrictEqual(prepared, corpusEntry.preparedEvidence)) fail("corpus_binding_mismatch", corpusEntry.evidencePath, `Prepared corpus entry ${manifestEntry.id} is detached from retained evidence`);
		if (hash(loaded.bytes) !== declared.benchmark_run_sha256) fail("source_hash_mismatch", declared.benchmark_run_id, `Benchmark Run ${declared.benchmark_run_id} byte hash mismatch`);
		const runFromBytes = parseEvaluationScorecardBenchmark(rawJson(loaded.bytes, declared.benchmark_run_id, "benchmark_artifact_malformed"), declared.benchmark_run_id, input.declaration.configuration_identity, declared.benchmark_run_id, repetitionCount);
		repetitionCount ??= runFromBytes.declaration.repetition_count;
		if (!isDeepStrictEqual(runFromBytes, loaded.run) || loaded.run.id !== declared.benchmark_run_id) fail("evidence_set_mismatch", declared.benchmark_run_id, "Parsed Benchmark Run is detached from its retained bytes or declared identity");
	}
}

function auditBundleBytes(input: Omit<LoadedEvaluationScorecardInput, "selectedOutputs">): void {
	if (hash(input.annotationBytes) !== input.declaration.annotations.sha256) fail("source_hash_mismatch", input.declaration.annotations.path, "Annotation byte hash mismatch");
	const annotations = parsed(rawJson(input.annotationBytes, input.declaration.annotations.path, "annotation_bundle_rejected"), AnnotationBundleSchema, input.declaration.annotations.path, "annotation_bundle_rejected");
	if (!isDeepStrictEqual(annotations, input.annotations)) fail("annotation_bundle_rejected", input.declaration.annotations.path, "Parsed annotations are detached from retained bytes");
	if (hash(input.reviewBytes) !== input.declaration.qualitative_reviews.sha256) fail("source_hash_mismatch", input.declaration.qualitative_reviews.path, "Review byte hash mismatch");
	const reviews = parsed(rawJson(input.reviewBytes, input.declaration.qualitative_reviews.path, "review_bundle_rejected"), QualitativeReviewBundleSchema, input.declaration.qualitative_reviews.path, "review_bundle_rejected");
	if (!isDeepStrictEqual(reviews, input.reviews)) fail("review_bundle_rejected", input.declaration.qualitative_reviews.path, "Parsed reviews are detached from retained bytes");
}

function classifyRuntimeRoster(run: z.infer<typeof V7BenchmarkRunBaseSchema>, path: string): void {
	const expected = run.trials.flatMap((trial) => trial.invocations.map((invocation) => ({
		trial_id: trial.id, invocation_id: invocation.id, config_identity: invocation.config_identity,
		production_step: invocation.production_step, ordinal: invocation.ordinal,
	})));
	if (run.runtime_evidence.length !== expected.length) fail("evidence_set_mismatch", path, "Runtime-evidence coverage does not match retained invocations");
	const actualIds = run.runtime_evidence.map(({ invocation_id }) => invocation_id);
	if (new Set(actualIds).size !== actualIds.length) fail("evidence_set_mismatch", path, "Runtime-evidence invocation coverage contains duplicates");
	const expectedIds = expected.map(({ invocation_id }) => invocation_id);
	if (actualIds.some((id, index) => id !== expectedIds[index])) {
		if (actualIds.length === expectedIds.length && actualIds.every((id) => expectedIds.includes(id))) fail("evidence_set_mismatch", path, "Runtime-evidence invocation coverage is reordered");
		fail("output_identity_mismatch", path, "Runtime evidence names a detached invocation identity");
	}
	for (const [index, actual] of run.runtime_evidence.entries()) {
		const identity = expected[index]!;
		if (actual.trial_id !== identity.trial_id || actual.config_identity !== identity.config_identity || actual.production_step !== identity.production_step || actual.ordinal !== identity.ordinal) fail("output_identity_mismatch", path, "Runtime evidence is detached from its retained invocation identity");
	}
}

export function parseEvaluationScorecardBenchmark(candidate: unknown, expectedId: string, expectedConfigIdentity: string, path: string, expectedRepetitionCount?: number): V7BenchmarkRun {
	const base = V7BenchmarkRunBaseSchema.safeParse(candidate);
	if (base.success) {
		if (base.data.id !== expectedId) fail("benchmark_filename_mismatch", path, "Benchmark Run filename identity mismatch");
		if (base.data.lifecycle !== "complete") fail("benchmark_not_complete", path, "Benchmark Run must be complete");
		if (base.data.harness_outcome !== "retained") fail("benchmark_not_retained", path, "Benchmark Run must be retained");
		const selectedConfigurations = base.data.declaration.configurations.filter(({ identity }) => identity === expectedConfigIdentity);
		if (selectedConfigurations.length !== 1 || evaluationConfigIdentity(selectedConfigurations[0]!.config) !== expectedConfigIdentity) fail("configuration_mismatch", path, "Selected Benchmark configuration is missing, duplicated, or detached from its identity");
		if (expectedRepetitionCount !== undefined && base.data.declaration.repetition_count !== expectedRepetitionCount) fail("repetition_mismatch", path, "Benchmark repetition count changed within the scorecard evidence set");
		if (!isDeepStrictEqual(base.data.provenance.output_contracts, v1OutputContractProvenance())) fail("provenance_mismatch", path, "Benchmark output-contract provenance changed");
		const prepared = base.data.prepared_evidence;
		if (prepared.identity_sha256 !== sha256Json(prepared.snapshot) || prepared.active_region_id !== prepared.snapshot.active_region_id || prepared.publication_date !== prepared.snapshot.publication_date || prepared.original_count !== prepared.snapshot.raw_count || prepared.final_count !== prepared.snapshot.final_count) fail("corpus_binding_mismatch", path, "Prepared-evidence identity or summary is detached from its retained snapshot");
		if (base.data.trials.length !== base.data.trial_roster.length || base.data.trials.some((trial, index) => {
			const roster = base.data.trial_roster[index];
			return roster === undefined || trial.id !== roster.trial_id || trial.config_identity !== roster.config_identity || trial.repetition !== roster.repetition;
		})) fail("evidence_set_mismatch", path, "Benchmark trial coverage is incomplete, duplicated, or reordered");
		classifyRuntimeRoster(base.data, path);
		const strict = V7BenchmarkRunSchema.safeParse(base.data);
		if (!strict.success) fail("benchmark_artifact_invalid", path, `Invalid Benchmark Run: ${strict.error.message}`, strict.error);
		return strict.data;
	}
	const historical = BenchmarkRunSchema.safeParse(candidate);
	if (historical.success) {
		if (historical.data.id !== expectedId) fail("benchmark_filename_mismatch", path, "Benchmark Run filename identity mismatch");
		fail("unsupported_benchmark_version", path, `Scorecards require Benchmark Run V7, received V${String(historical.data.version)}`);
	}
	fail("benchmark_artifact_invalid", path, `Invalid Benchmark Run: ${base.error.message}`, base.error);
}

function outputIdentity(loaded: LoadedScorecardRun, trial: V7BenchmarkRun["trials"][number], invocation: V7BenchmarkRun["trials"][number]["invocations"][number]): OutputIdentity {
	if (invocation.transport !== "succeeded" || invocation.parse.state !== "succeeded") throw new Error("Output identity requires parse success");
	const runtime = loaded.run.runtime_evidence.find(({ invocation_id }) => invocation_id === invocation.id);
	if (runtime?.state !== "captured") fail("output_identity_mismatch", loaded.declaration.benchmark_run_id, `Missing captured runtime evidence for ${invocation.id}`);
	return {
		benchmark_run_id: loaded.run.id, benchmark_run_version: 7, benchmark_run_sha256: loaded.declaration.benchmark_run_sha256,
		code_commit_sha: loaded.run.provenance.code.commit_sha, fixture_sha256: loaded.run.fixture.fixture_sha256,
		prepared_evidence_identity_sha256: loaded.run.prepared_evidence.identity_sha256,
		corpus_manifest_id: "", corpus_manifest_sha256: "", corpus_fixture_id: loaded.declaration.corpus_fixture_id,
		reference_sha256: loaded.corpusEntry.manifestEntry.reference_sha256, config_identity: trial.config_identity,
		trial_id: trial.id, repetition: trial.repetition, invocation_id: invocation.id, production_step: invocation.production_step,
		invocation_ordinal: invocation.ordinal, request_sha256: invocation.request_sha256,
		completion_text_sha256: hash(Buffer.from(invocation.completion.text)), parsed_output_sha256: sha256Json(canonical(invocation.parse.output)),
		runtime_evidence_sha256: sha256Json(canonical(runtime.evidence)),
	};
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
function spanKey(span: { json_pointer: string; start_utf16: number; end_utf16: number; excerpt: string }): string { return JSON.stringify([span.json_pointer, span.start_utf16, span.end_utf16, span.excerpt]); }

function validateSpans(annotation: AnnotationBundle["outputs"][number], output: SelectedScorecardOutput, path: string): void {
	const claims = annotation.factual_claims;
	unique(claims.map(({ id }) => id), path, "annotation_completeness_mismatch", "Claim ids must be unique per output");
	unique(claims.map(({ proposition }) => proposition.normalize().toLowerCase()), path, "annotation_completeness_mismatch", "Normalized claim propositions must be unique per output");
	unique(claims.map(({ spans }) => JSON.stringify(spans.map(spanKey).sort())), path, "annotation_completeness_mismatch", "Claim span inventories must be unique per output");
	for (const claim of claims) unique(claim.spans.map(spanKey), path, "annotation_completeness_mismatch", `Claim ${claim.id} contains duplicate spans`);
	const allSpans = [...claims.flatMap(({ spans }) => spans), ...annotation.event_coverage.flatMap(({ spans }) => spans)];
	for (const span of allSpans) {
		if (output.invocation.transport !== "succeeded" || output.invocation.parse.state !== "succeeded") throw new Error("Selected output must be parse success");
		const value = outputString(output.invocation.parse.output, span.json_pointer);
		if (value === undefined || span.start_utf16 >= span.end_utf16 || span.end_utf16 > value.length
			|| splitsSurrogate(value, span.start_utf16) || splitsSurrogate(value, span.end_utf16)
			|| value.slice(span.start_utf16, span.end_utf16) !== span.excerpt) fail("span_mismatch", path, `Output span does not bind exact parsed text for ${output.identity.invocation_id}`);
	}
}

type ReferenceRecord = { readonly kind: "claim" | "event" | "ambiguity" | "entity" | "number" | "noteworthy"; readonly status?: "established" | "contested" | "unresolved" };
function referenceRecord(entry: LoadedEvaluationReferenceCorpusEntry, id: string): ReferenceRecord | undefined {
	const [kind, recordId, extra] = id.split(":"); if (extra !== undefined || recordId === undefined) return undefined;
	if (kind === "claim" || kind === "event") { const record = entry.reference[`${kind}s`].find(({ id: candidate }) => candidate === recordId); return record === undefined ? undefined : { kind, status: record.status }; }
	if (kind === "ambiguity") return entry.reference.ambiguities.some(({ id: candidate }) => candidate === recordId) ? { kind } : undefined;
	if (kind === "entity") return entry.reference.entities.some(({ id: candidate }) => candidate === recordId) ? { kind } : undefined;
	if (kind === "number") return entry.reference.numbers.some(({ id: candidate }) => candidate === recordId) ? { kind } : undefined;
	if (kind === "noteworthy") return entry.reference.noteworthy_candidates.some(({ id: candidate }) => candidate === recordId) ? { kind } : undefined;
	return undefined;
}

function validateRelations(annotation: AnnotationBundle["outputs"][number], selected: SelectedScorecardOutput, path: string): void {
	for (const claim of annotation.factual_claims) {
		unique(claim.references.map(({ reference_id }) => reference_id), path, "reference_mismatch", `Claim ${claim.id} repeats a reference`);
		for (const reference of claim.references) {
			const record = referenceRecord(selected.run.corpusEntry, reference.reference_id);
			if (record === undefined) fail("reference_mismatch", path, `Unknown paired reference ${reference.reference_id}`);
			const qualified = (record.kind === "claim" || record.kind === "event") && record.status === "established";
			const uncertain = record.kind === "ambiguity" || ((record.kind === "claim" || record.kind === "event") && record.status !== "established");
			if ((reference.relation === "supports" || reference.relation === "opposes") && !qualified && !["entity", "number", "noteworthy"].includes(record.kind)) fail("relation_mismatch", path, `Unqualified ${reference.relation} is forbidden for ${reference.reference_id}`);
			if (reference.relation === "supports_status_qualified" && !uncertain) fail("relation_mismatch", path, `Status-qualified support requires uncertain evidence`);
			if (reference.relation === "unresolved" && !uncertain) fail("relation_mismatch", path, `Unresolved relation requires uncertain evidence`);
			if (["entity", "number", "noteworthy"].includes(record.kind) && reference.relation !== "supports") fail("relation_mismatch", path, `${record.kind} permits supports only`);
		}
		const supports = claim.references.some(({ relation }) => relation === "supports" || relation === "supports_status_qualified");
		const unresolved = claim.references.some(({ relation }) => relation === "unresolved");
		if ((claim.grounding === "grounded" && !supports) || (claim.grounding === "not_grounded" && supports) || (claim.grounding === "indeterminate" && !unresolved)) fail("relation_mismatch", path, `Grounding relation shape is invalid for ${claim.id}`);
		if ((claim.attribution_requirement === "required" && claim.attribution === "not_applicable") || (claim.attribution_requirement === "not_required" && claim.attribution !== "not_applicable") || (claim.attribution_requirement === "indeterminate" && claim.attribution !== "indeterminate")) fail("relation_mismatch", path, `Attribution shape is invalid for ${claim.id}`);
	}
}

function validateAnnotation(annotation: AnnotationBundle["outputs"][number], selected: SelectedScorecardOutput, path: string): void {
	validateSpans(annotation, selected, path); validateRelations(annotation, selected, path);
	const events = selected.run.corpusEntry.reference.events;
	if (!isDeepStrictEqual(annotation.event_coverage.map(({ event_id }) => event_id), events.map(({ id }) => id))) fail("annotation_completeness_mismatch", path, "Event coverage must exactly preserve paired reference order");
	for (const event of annotation.event_coverage) if ((event.assessment === "covered" && event.spans.length === 0) || (event.assessment === "not_covered" && event.spans.length !== 0)) fail("annotation_completeness_mismatch", path, `Event span shape is invalid for ${event.event_id}`);
	const announcementRole = selected.identity.production_step.startsWith("announcements");
	if (!announcementRole && annotation.announcement_relevance.state !== "not_applicable") fail("annotation_completeness_mismatch", path, "Main-story output cannot assess announcement relevance");
	if (announcementRole) {
		if (annotation.announcement_relevance.state !== "assessed") fail("annotation_completeness_mismatch", path, "Announcement output requires relevance assessment");
		if (selected.invocation.transport !== "succeeded" || selected.invocation.parse.state !== "succeeded") throw new Error("Selected output must be parse success");
		const announcements = selected.invocation.parse.output.announcements;
		if (!Array.isArray(announcements) || annotation.announcement_relevance.announcements.length !== announcements.length || annotation.announcement_relevance.announcements.some(({ announcement_index }, index) => announcement_index !== index)) fail("annotation_completeness_mismatch", path, "Announcement denominator must exactly match parsed output array order");
		for (const item of annotation.announcement_relevance.announcements) {
			unique(item.noteworthy_reference_ids, path, "annotation_completeness_mismatch", "Noteworthy ids must be unique");
			if (item.noteworthy_reference_ids.some((id) => referenceRecord(selected.run.corpusEntry, id)?.kind !== "noteworthy")) fail("reference_mismatch", path, "Announcement relevance names an unknown candidate");
			if ((item.assessment === "relevant" && item.noteworthy_reference_ids.length === 0) || (item.assessment === "not_relevant" && item.noteworthy_reference_ids.length !== 0)) fail("relation_mismatch", path, "Announcement relevance relation shape is invalid");
		}
	}
}

export function validateLoadedEvaluationScorecardInput(input: Omit<LoadedEvaluationScorecardInput, "selectedOutputs">): LoadedEvaluationScorecardInput {
	const { declaration, corpus, runs, annotations, reviews, declarationPath } = input;
	auditRetainedSources(input);
	if (declaration.runs.some(({ ordinal }, index) => ordinal !== index + 1)) fail("evidence_set_mismatch", declarationPath, "Run ordinals must be contiguous");
	if (declaration.corpus.manifest_sha256 !== corpus.manifestSha256) fail("source_hash_mismatch", corpus.manifestPath, "Corpus manifest byte hash mismatch");
	if (!isDeepStrictEqual(declaration.runs.map(({ corpus_fixture_id }) => corpus_fixture_id), corpus.entries.map(({ manifestEntry }) => manifestEntry.id))) fail("evidence_set_mismatch", declarationPath, "Runs must match the complete corpus manifest in order");
	unique(runs.map(({ run }) => run.id), declarationPath, "evidence_set_mismatch", "Benchmark runs must be unique");
	let repetitionCount: number | undefined; let exactConfig: unknown; let provenance: unknown;
	const selectedOutputs: SelectedScorecardOutput[] = [];
	for (const loaded of runs) {
		const { run, declaration: declared, corpusEntry } = loaded;
		if (run.version !== 7) fail("unsupported_benchmark_version", declared.benchmark_run_id, "Scorecards require Benchmark Run V7");
		if (run.lifecycle !== "complete") fail("benchmark_not_complete", run.id, "Benchmark Run must be complete");
		if (run.harness_outcome !== "retained") fail("benchmark_not_retained", run.id, "Benchmark Run must be retained");
		if (run.fixture.fixture_sha256 !== corpusEntry.manifestEntry.evidence_sha256 || run.prepared_evidence.identity_sha256 !== sha256Json(corpusEntry.preparedEvidence) || !isDeepStrictEqual(run.prepared_evidence.snapshot, corpusEntry.preparedEvidence)) fail("corpus_binding_mismatch", run.id, "Benchmark fixture/prepared evidence does not match corpus entry");
		const declarations = run.declaration.configurations.filter(({ identity }) => identity === declaration.configuration_identity);
		if (declarations.length !== 1) fail("configuration_mismatch", run.id, "Selected configuration must occur exactly once");
		if (exactConfig === undefined) exactConfig = declarations[0]!.config; else if (!isDeepStrictEqual(exactConfig, declarations[0]!.config)) fail("configuration_mismatch", run.id, "Selected configuration changed between runs");
		if (repetitionCount === undefined) repetitionCount = run.declaration.repetition_count; else if (repetitionCount !== run.declaration.repetition_count) fail("repetition_mismatch", run.id, "Repetition count changed between runs");
		const currentProvenance = { code: run.provenance.code, output_contracts: run.provenance.output_contracts };
		if (provenance === undefined) provenance = currentProvenance; else if (!isDeepStrictEqual(provenance, currentProvenance)) fail("provenance_mismatch", run.id, "Code or output-contract provenance changed between runs");
		const roster = run.trial_roster.filter(({ config_identity }) => config_identity === declaration.configuration_identity);
		const trials = run.trials.filter(({ config_identity }) => config_identity === declaration.configuration_identity);
		if (roster.length !== run.declaration.repetition_count || trials.length !== roster.length || trials.some((trial, index) => trial.id !== roster[index]?.trial_id || trial.lifecycle !== "complete")) fail("evidence_set_mismatch", run.id, "Selected trial roster is incomplete or reordered");
		for (const trial of trials) for (const invocation of trial.invocations) if (invocation.transport === "succeeded" && invocation.parse.state === "succeeded") {
			const identity = outputIdentity(loaded, trial, invocation); identity.corpus_manifest_id = corpus.manifest.id; identity.corpus_manifest_sha256 = corpus.manifestSha256;
			const runtime = run.runtime_evidence.find(({ invocation_id }) => invocation_id === invocation.id);
			if (runtime?.state !== "captured") fail("output_identity_mismatch", run.id, `Runtime evidence missing for ${invocation.id}`);
			selectedOutputs.push({ identity, run: loaded, trial, invocation, runtime });
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

function nestedNodeError(error: unknown): NodeJS.ErrnoException | undefined {
	if (error !== null && typeof error === "object") {
		if (typeof (error as NodeJS.ErrnoException).code === "string" && ["EACCES", "EIO", "ELOOP", "EMFILE", "ENFILE", "ENOENT", "ENOTDIR", "EPERM"].includes((error as NodeJS.ErrnoException).code!)) return error as NodeJS.ErrnoException;
		return nestedNodeError((error as { cause?: unknown }).cause);
	}
	return undefined;
}

async function corpusRosterHasUnreadableEntry(corpusPath: string): Promise<boolean> {
	try {
		const manifest = JSON.parse(await readFile(corpusPath, "utf8")) as { fixtures?: Array<{ id?: unknown }> };
		if (!Array.isArray(manifest.fixtures)) return false;
		for (const fixture of manifest.fixtures) {
			if (typeof fixture.id !== "string") continue;
			for (const directory of ["evidence", "references"]) {
				try { await readFile(join(dirname(corpusPath), directory, `${fixture.id}.json`)); }
				catch (cause) { if (nestedNodeError(cause) !== undefined) return true; throw cause; }
			}
		}
		return false;
	} catch (cause) { return nestedNodeError(cause) !== undefined; }
}

async function mapCorpusError(error: unknown, fallbackPath: string): Promise<never> {
	if (error instanceof EvaluationReferenceCorpusError) {
		if (error.code === "hash_mismatch") fail("source_hash_mismatch", error.path, error.message, error);
		if (error.code === "directory_not_closed" && await corpusRosterHasUnreadableEntry(fallbackPath)) fail("source_unreadable", error.path, error.message, error);
		if (error.code === "missing_owned_path" || nestedNodeError(error) !== undefined) fail("source_unreadable", error.path, error.message, error);
		fail("corpus_binding_mismatch", error.path, error.message, error);
	}
	if (nestedNodeError(error) !== undefined) fail("source_unreadable", fallbackPath, "Cannot read evaluation reference corpus", error);
	fail("corpus_binding_mismatch", fallbackPath, "Evaluation reference corpus rejected", error);
}

export async function loadEvaluationScorecardInput(declarationPath: string): Promise<LoadedEvaluationScorecardInput> {
	const absolute = resolve(declarationPath); const declarationBytes = await bytes(absolute);
	const declaration = parsed(json(declarationBytes, absolute, "invalid_declaration_json"), EvaluationScorecardDeclarationSchema, absolute, "declaration_rejected");
	const root = dirname(absolute); const corpusPath = resolve(root, declaration.corpus.manifest_path);
	let corpus: LoadedEvaluationReferenceCorpus;
	try { corpus = await loadEvaluationReferenceCorpus(corpusPath); } catch (cause) { return mapCorpusError(cause, corpusPath); }
	if (corpus.manifestSha256 !== declaration.corpus.manifest_sha256) fail("source_hash_mismatch", corpus.manifestPath, "Corpus manifest byte hash mismatch");
	const results = resolve(root, declaration.benchmark_results_directory);
	const runs: LoadedScorecardRun[] = []; let expectedRepetitionCount: number | undefined;
	for (const [index, declared] of declaration.runs.entries()) {
		const path = join(results, `${declared.benchmark_run_id}.json`); const runBytes = await bytes(path);
		if (hash(runBytes) !== declared.benchmark_run_sha256) fail("source_hash_mismatch", path, "Benchmark Run byte hash mismatch");
		const candidate = json(runBytes, path, "benchmark_artifact_malformed");
		const run = parseEvaluationScorecardBenchmark(candidate, declared.benchmark_run_id, declaration.configuration_identity, path, expectedRepetitionCount);
		expectedRepetitionCount ??= run.declaration.repetition_count;
		runs.push({ declaration: declared, bytes: runBytes, run, corpusEntry: corpus.entries[index]! });
	}
	const annotationPath = resolve(root, declaration.annotations.path); const annotationBytes = await bytes(annotationPath);
	if (hash(annotationBytes) !== declaration.annotations.sha256) fail("source_hash_mismatch", annotationPath, "Annotation byte hash mismatch");
	const annotations = parsed(json(annotationBytes, annotationPath, "annotation_bundle_rejected"), AnnotationBundleSchema, annotationPath, "annotation_bundle_rejected");
	const reviewPath = resolve(root, declaration.qualitative_reviews.path); const reviewBytes = await bytes(reviewPath);
	if (hash(reviewBytes) !== declaration.qualitative_reviews.sha256) fail("source_hash_mismatch", reviewPath, "Review byte hash mismatch");
	const reviews = parsed(json(reviewBytes, reviewPath, "review_bundle_rejected"), QualitativeReviewBundleSchema, reviewPath, "review_bundle_rejected");
	return validateLoadedEvaluationScorecardInput({ declarationPath: absolute, declarationBytes, declaration, corpus, runs, annotationBytes, annotations, reviewBytes, reviews });
}
