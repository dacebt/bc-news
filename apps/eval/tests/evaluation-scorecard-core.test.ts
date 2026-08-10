import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
	AnnotationBundleSchema, EVALUATION_SCORECARD_ERROR_CODES, EvaluationScorecardArtifactSchema,
	EvaluationScorecardDeclarationSchema, OutputIdentitySchema, QualitativeReviewBundleSchema,
} from "../src/evaluation-scorecard";
import { loadEvaluationScorecardInput, parseEvaluationScorecardBenchmark } from "../src/evaluation-scorecard-input";
import { loadEvaluationScorecardArtifact } from "../src/evaluation-scorecard-store";
import { evaluationConfigIdentity, sha256Json } from "../src/evaluation-artifact-schemas";
import { v1OutputContractProvenance } from "../src/evaluation-artifact-v1-contracts";
import { V7BenchmarkRunBaseSchema } from "../src/evaluation-artifact-v7";
import { buildEvaluationScorecard } from "../src/evaluation-scorecard-builder";
import { buildControlledEvaluationScorecardInput } from "../src/evaluation-scorecard-verifier";

const roots = new Set<string>();
afterEach(async () => { await Promise.all([...roots].map((root) => rm(root, { recursive: true, force: true }))); roots.clear(); });
async function temporaryRoot(): Promise<string> { const root = await mkdtemp(join(tmpdir(), "bc-news-scorecard-core-")); roots.add(root); return root; }
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const HASH = "1".repeat(64);
const CORPUS_ROOT = new URL("../../../packages/fixtures/evaluation-corpus/", import.meta.url).pathname;

function outputIdentity() {
	return OutputIdentitySchema.parse({
		benchmark_run_id: "benchmark-one", benchmark_run_version: 7, benchmark_run_sha256: HASH,
		code_commit_sha: "2".repeat(40), fixture_sha256: HASH, prepared_evidence_identity_sha256: HASH,
		corpus_manifest_id: "evaluation-reference-corpus", corpus_manifest_sha256: HASH,
		corpus_fixture_id: "fixture-one", reference_sha256: HASH, config_identity: "config-one",
		trial_id: "trial-one", repetition: 1, invocation_id: "invocation-one",
		production_step: "main_story_write", invocation_ordinal: 1, request_sha256: HASH,
		completion_text_sha256: HASH, parsed_output_sha256: HASH, runtime_evidence_sha256: HASH,
	});
}

function annotationBundle() {
	return {
		version: 1, protocol: { id: "bc-news-output-annotation", version: 1 }, annotator: { id: "editor-one", kind: "human" },
		annotated_at: "2026-08-10T12:00:00.000Z", outputs: [{ annotation_id: "annotation-one", output: outputIdentity(),
			factual_claim_inventory_complete: true, factual_claims: [], event_coverage: [], announcement_relevance: { state: "not_applicable" } }],
	};
}

function reviewBundle() {
	return {
		version: 1, rubric: { id: "bc-news-editorial-qualitative", version: 1 }, reviewer: { id: "reviewer-one", kind: "human" },
		reviewed_at: "2026-08-10T12:00:00.000Z", reviews: [{ review_id: "review-one", output: outputIdentity(), criteria: [
			{ criterion: "coherence", assessment: "meets", rationale: "The output is internally understandable.", uncertainty: "low" },
			{ criterion: "usefulness", assessment: "partly_meets", rationale: "The output contains some useful information.", uncertainty: "medium" },
			{ criterion: "newsworthiness", assessment: "uncertain", rationale: "The editorial significance is uncertain.", uncertainty: "high" },
			{ criterion: "voice", assessment: "does_not_meet", rationale: "The output does not use the declared voice.", uncertainty: "low" },
		] }],
	};
}

function structurallyValidV7Candidate() {
	const config = { production_steps: {
		main_story_write: { adapter: "openai_compatible_hosted", provider: "test", model: "test/main-write", billing: { method: "calculated", input_usd_per_million_tokens: 0, output_usd_per_million_tokens: 0, pricing_reference: "test" } },
		main_story_copyedit: { adapter: "openai_compatible_hosted", provider: "test", model: "test/main-copyedit", billing: { method: "calculated", input_usd_per_million_tokens: 0, output_usd_per_million_tokens: 0, pricing_reference: "test" } },
		announcements_write: { adapter: "openai_compatible_hosted", provider: "test", model: "test/announcements-write", billing: { method: "calculated", input_usd_per_million_tokens: 0, output_usd_per_million_tokens: 0, pricing_reference: "test" } },
		announcements_copyedit: { adapter: "openai_compatible_hosted", provider: "test", model: "test/announcements-copyedit", billing: { method: "calculated", input_usd_per_million_tokens: 0, output_usd_per_million_tokens: 0, pricing_reference: "test" } },
	} } as const;
	const configIdentity = evaluationConfigIdentity(config); const snapshot = { active_region_id: "1", publication_date: "2026-08-10", raw_count: 0, after_filter_count: 0, after_burst_count: 0, final_count: 0, drop_stats: { empty_after_trim: 0, too_short: 0, burst_merged: 0, sampling_dropped: 0 }, messages: [] };
	const request = { production_step: "main_story_write" as const, system: "system", user: "user" };
	return V7BenchmarkRunBaseSchema.parse({
		version: 7, id: "benchmark-one", lifecycle: "complete", started_at: "2026-08-10T10:00:00.000Z", completed_at: "2026-08-10T10:00:02.000Z",
		declaration: { configurations: [{ identity: configIdentity, config }], repetition_count: 1, transport_retry_limit: 0 },
		fixture: { path: "fixture.json", fixture_sha256: HASH }, prepared_evidence: { identity_sha256: sha256Json(snapshot), active_region_id: "1", publication_date: "2026-08-10", original_count: 0, final_count: 0, snapshot },
		provenance: { code: { repository: "bc-news", commit_sha: "2".repeat(40), dirty: false }, output_contracts: v1OutputContractProvenance() },
		trial_roster: [{ trial_id: "trial-one", config_identity: configIdentity, repetition: 1 }],
		trials: [{ id: "trial-one", config_identity: configIdentity, repetition: 1, lifecycle: "complete", started_at: "2026-08-10T10:00:00.000Z", completed_at: "2026-08-10T10:00:01.000Z", subject_outcome: "infrastructure_incomplete",
			tracks: { main_story: { lifecycle: "rejected", subject_outcome: "infrastructure_incomplete", terminal_production_step: "main_story_write", product: null, findings: [] }, announcements: { lifecycle: "pending", subject_outcome: null, terminal_production_step: null, product: null, findings: [] } },
			selected_invocation_ids: { main_story_write: null, main_story_copyedit: null, announcements_write: null, announcements_copyedit: null },
			invocations: [{ id: "invocation-one", production_step: "main_story_write", config_identity: configIdentity, ordinal: 1, predecessor_invocation_id: null, request, request_sha256: sha256Json(request), started_at: "2026-08-10T10:00:00.000Z", transport: "failed", failure: { code: "test_failure", message: "Controlled failure" }, ended_at: "2026-08-10T10:00:01.000Z", duration_ms: 1_000, retry_classification: { state: "classified", eligible: false, reason: "controlled" }, parse: { state: "pending" } }],
		}], runtime_evidence: [], outcome_counts: { completed: 0, parse_rejected: 0, contract_rejected: 0, infrastructure_incomplete: 1 }, harness_outcome: "retained",
	});
}

test("keeps human annotations and ordered qualitative reviews strict and unweighted", () => {
	expect(AnnotationBundleSchema.parse(annotationBundle()).outputs).toHaveLength(1);
	expect(QualitativeReviewBundleSchema.parse(reviewBundle()).reviews[0]?.criteria.map(({ criterion }) => criterion)).toEqual(["coherence", "usefulness", "newsworthiness", "voice"]);
	expect(AnnotationBundleSchema.safeParse({ ...annotationBundle(), annotator: { id: "model", kind: "model" } }).success).toBe(false);
	const weighted = structuredClone(reviewBundle()) as Record<string, unknown>;
	const reviews = weighted.reviews as Array<Record<string, unknown>>; reviews[0]!.weight = 1;
	expect(QualitativeReviewBundleSchema.safeParse(weighted).success).toBe(false);
	const reordered = structuredClone(reviewBundle()); [reordered.reviews[0]!.criteria[0], reordered.reviews[0]!.criteria[1]] = [reordered.reviews[0]!.criteria[1]!, reordered.reviews[0]!.criteria[0]!];
	expect(QualitativeReviewBundleSchema.safeParse(reordered).success).toBe(false);
});

test("rejects undeclared fields and noncanonical embedded payloads at scorecard boundaries", () => {
	const declaration = { version: 1, id: "scorecard-input", corpus: { manifest_path: "fixtures/evaluation-corpus/manifest.json", manifest_sha256: HASH }, benchmark_results_directory: "results", configuration_identity: "config-one", runs: [{ ordinal: 1, corpus_fixture_id: "fixture-one", benchmark_run_id: "benchmark-one", benchmark_run_sha256: HASH }], annotations: { path: "annotations.json", sha256: HASH }, qualitative_reviews: { path: "reviews.json", sha256: HASH } };
	expect(EvaluationScorecardDeclarationSchema.safeParse({ ...declaration, overall: 1 }).success).toBe(false);
	expect(EvaluationScorecardArtifactSchema.safeParse({ version: 1, id: "scorecard-one", overall: 1 }).success).toBe(false);
	expect(EVALUATION_SCORECARD_ERROR_CODES).toHaveLength(33);
});

test("classifies declaration syntax, declaration shape, invalid ids, and missing artifacts", async () => {
	const root = await temporaryRoot(); const malformed = join(root, "malformed.json");
	await writeFile(malformed, "{", "utf8");
	await expect(loadEvaluationScorecardInput(malformed)).rejects.toMatchObject({ code: "invalid_declaration_json", path: malformed });
	const rejected = join(root, "rejected.json"); await writeFile(rejected, JSON.stringify({ version: 1 }), "utf8");
	await expect(loadEvaluationScorecardInput(rejected)).rejects.toMatchObject({ code: "declaration_rejected", path: rejected });
	await expect(loadEvaluationScorecardArtifact("../escape", root)).rejects.toMatchObject({ code: "invalid_scorecard_id" });
	await expect(loadEvaluationScorecardArtifact("missing-scorecard", root)).rejects.toMatchObject({ code: "scorecard_not_found", path: join(root, "missing-scorecard.json") });
});

test("binds declaration hashes to exact bytes rather than parsed-value equivalence", () => {
	const compact = JSON.stringify({ version: 1 }); const pretty = `${JSON.stringify({ version: 1 }, null, 2)}\n`;
	expect(hash(compact)).not.toBe(hash(pretty));
});

test("classifies strict V7 lifecycle, provenance, and runtime identity failures before generic artifact rejection", () => {
	const unretained = structurallyValidV7Candidate(); unretained.harness_outcome = "pending";
	const configIdentity = unretained.declaration.configurations[0]!.identity;
	expect(() => parseEvaluationScorecardBenchmark(unretained, unretained.id, configIdentity, "run.json")).toThrow(expect.objectContaining({ code: "benchmark_not_retained" }));
	const provenance = structurallyValidV7Candidate(); provenance.provenance.output_contracts[0].schema_sha256 = "3".repeat(64);
	expect(() => parseEvaluationScorecardBenchmark(provenance, provenance.id, configIdentity, "run.json")).toThrow(expect.objectContaining({ code: "provenance_mismatch" }));
	const detachedPreparedEvidence = structurallyValidV7Candidate(); detachedPreparedEvidence.prepared_evidence.identity_sha256 = "4".repeat(64);
	expect(() => parseEvaluationScorecardBenchmark(detachedPreparedEvidence, detachedPreparedEvidence.id, configIdentity, "run.json")).toThrow(expect.objectContaining({ code: "corpus_binding_mismatch" }));
	const changedConfiguration = structurallyValidV7Candidate(); const adapter = changedConfiguration.declaration.configurations[0]!.config.production_steps.main_story_write;
	if (adapter.adapter !== "openai_compatible_hosted") throw new Error("Expected hosted test adapter");
	adapter.model = "test/changed-model";
	expect(() => parseEvaluationScorecardBenchmark(changedConfiguration, changedConfiguration.id, configIdentity, "run.json")).toThrow(expect.objectContaining({ code: "configuration_mismatch" }));
	const changedRepetition = structurallyValidV7Candidate(); changedRepetition.declaration.repetition_count = 2;
	expect(() => parseEvaluationScorecardBenchmark(changedRepetition, changedRepetition.id, configIdentity, "run.json", 1)).toThrow(expect.objectContaining({ code: "repetition_mismatch" }));
	const missingRuntime = structurallyValidV7Candidate();
	expect(() => parseEvaluationScorecardBenchmark(missingRuntime, missingRuntime.id, configIdentity, "run.json")).toThrow(expect.objectContaining({ code: "evidence_set_mismatch" }));
	const detachedRuntime = structurallyValidV7Candidate(); detachedRuntime.runtime_evidence.push({ trial_id: "detached-trial", invocation_id: "invocation-one", config_identity: detachedRuntime.declaration.configurations[0]!.identity, production_step: "main_story_write", ordinal: 1, state: "unavailable", reason: "transport_failed" });
	expect(() => parseEvaluationScorecardBenchmark(detachedRuntime, detachedRuntime.id, configIdentity, "run.json")).toThrow(expect.objectContaining({ code: "output_identity_mismatch" }));
	expect(() => parseEvaluationScorecardBenchmark({ version: 7 }, "benchmark-one", configIdentity, "run.json")).toThrow(expect.objectContaining({ code: "benchmark_artifact_invalid" }));
});

async function scorecardDeclarationForCorpus(root: string, manifestPath: string, manifestSha256: string): Promise<string> {
	const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { fixtures: Array<{ id: string }> };
	const path = join(root, "declaration.json");
	await writeFile(path, JSON.stringify({
		version: 1, id: "corpus-error-proof", corpus: { manifest_path: manifestPath, manifest_sha256: manifestSha256 },
		benchmark_results_directory: join(root, "results"), configuration_identity: "config-one",
		runs: manifest.fixtures.map(({ id }, index) => ({ ordinal: index + 1, corpus_fixture_id: id, benchmark_run_id: `run-${String(index + 1)}`, benchmark_run_sha256: HASH })),
		annotations: { path: "annotations.json", sha256: HASH }, qualitative_reviews: { path: "reviews.json", sha256: HASH },
	}), "utf8");
	return path;
}

test("separates unreadable corpus sources and byte mismatches from semantic corpus binding", async () => {
	const root = await temporaryRoot();
	const missingManifest = join(root, "missing", "evaluation-corpus", "manifest.json");
	await mkdir(join(root, "missing", "evaluation-corpus", "evidence"), { recursive: true }); await mkdir(join(root, "missing", "evaluation-corpus", "references"), { recursive: true });
	const missingDeclaration = join(root, "missing-declaration.json");
	await writeFile(missingDeclaration, JSON.stringify({ version: 1, id: "missing-proof", corpus: { manifest_path: missingManifest, manifest_sha256: HASH }, benchmark_results_directory: "results", configuration_identity: "config-one", runs: [{ ordinal: 1, corpus_fixture_id: "fixture-one", benchmark_run_id: "run-one", benchmark_run_sha256: HASH }], annotations: { path: "annotations.json", sha256: HASH }, qualitative_reviews: { path: "reviews.json", sha256: HASH } }), "utf8");
	await expect(loadEvaluationScorecardInput(missingDeclaration)).rejects.toMatchObject({ code: "source_unreadable", path: missingManifest });

	const copiedRoot = join(root, "copied", "evaluation-corpus"); await cp(CORPUS_ROOT, copiedRoot, { recursive: true });
	const manifestPath = join(copiedRoot, "manifest.json"); const manifestBytes = await readFile(manifestPath); const manifestSha = hash(Buffer.from(manifestBytes).toString("utf8"));
	const manifest = JSON.parse(Buffer.from(manifestBytes).toString("utf8")) as { fixtures: Array<{ id: string }> }; const firstId = manifest.fixtures[0]!.id;
	const missingEvidenceDeclaration = await scorecardDeclarationForCorpus(root, manifestPath, manifestSha);
	await rm(join(copiedRoot, "evidence", `${firstId}.json`));
	await expect(loadEvaluationScorecardInput(missingEvidenceDeclaration)).rejects.toMatchObject({ code: "source_unreadable", path: join(copiedRoot, "evidence") });
	await cp(join(CORPUS_ROOT, "evidence", `${firstId}.json`), join(copiedRoot, "evidence", `${firstId}.json`));
	await rm(join(copiedRoot, "references", `${firstId}.json`));
	await expect(loadEvaluationScorecardInput(missingEvidenceDeclaration)).rejects.toMatchObject({ code: "source_unreadable", path: join(copiedRoot, "references") });
	await cp(join(CORPUS_ROOT, "references", `${firstId}.json`), join(copiedRoot, "references", `${firstId}.json`));
	const wrongManifestDeclaration = await scorecardDeclarationForCorpus(root, manifestPath, "f".repeat(64));
	await expect(loadEvaluationScorecardInput(wrongManifestDeclaration)).rejects.toMatchObject({ code: "source_hash_mismatch", path: manifestPath });
	await scorecardDeclarationForCorpus(root, manifestPath, manifestSha);
	await writeFile(join(copiedRoot, "evidence", `${firstId}.json`), "{}\n", "utf8");
	await expect(loadEvaluationScorecardInput(missingEvidenceDeclaration)).rejects.toMatchObject({ code: "source_hash_mismatch" });
}, 15_000);

test("direct builder rejects sliced, reordered, byte-detached, and parsed-detached loaded evidence", async () => {
	const root = await temporaryRoot(); const controlled = await buildControlledEvaluationScorecardInput(root, join(CORPUS_ROOT, "manifest.json"));
	const loaded = await loadEvaluationScorecardInput(controlled.declarationPath); const options = { id: "core-loaded-input-proof", createdAt: controlled.createdAt };
	expect(buildEvaluationScorecard(loaded, options).scorecards).toHaveLength(4);
	expect(() => buildEvaluationScorecard({ ...loaded, runs: loaded.runs.slice(1) }, options)).toThrow(expect.objectContaining({ code: "evidence_set_mismatch" }));
	const reorderedRuns = [...loaded.runs]; [reorderedRuns[0], reorderedRuns[1]] = [reorderedRuns[1]!, reorderedRuns[0]!];
	expect(() => buildEvaluationScorecard({ ...loaded, runs: reorderedRuns }, options)).toThrow(expect.objectContaining({ code: "evidence_set_mismatch" }));
	expect(() => buildEvaluationScorecard({ ...loaded, annotations: { ...loaded.annotations, outputs: loaded.annotations.outputs.slice(1) } }, options)).toThrow(expect.objectContaining({ code: "annotation_completeness_mismatch" }));
	expect(() => buildEvaluationScorecard({ ...loaded, reviews: { ...loaded.reviews, reviews: loaded.reviews.reviews.slice(1) } }, options)).toThrow(expect.objectContaining({ code: "review_completeness_mismatch" }));
	const rawDetachedRuns = loaded.runs.map((run, index) => index === 0 ? { ...run, bytes: Buffer.concat([run.bytes, Buffer.from(" ")]) } : run);
	expect(() => buildEvaluationScorecard({ ...loaded, runs: rawDetachedRuns }, options)).toThrow(expect.objectContaining({ code: "source_hash_mismatch" }));
	const parsedDetachedRuns = loaded.runs.map((run, index) => index === 0 ? { ...run, run: { ...run.run, id: "detached-parsed-run" } } : run);
	expect(() => buildEvaluationScorecard({ ...loaded, runs: parsedDetachedRuns }, options)).toThrow(expect.objectContaining({ code: "evidence_set_mismatch" }));
	expect(() => buildEvaluationScorecard({ ...loaded, declaration: { ...loaded.declaration, id: "detached-declaration" } }, options)).toThrow(expect.objectContaining({ code: "declaration_rejected" }));
	expect(() => buildEvaluationScorecard({ ...loaded, annotations: { ...loaded.annotations, annotator: { id: "detached-annotator", kind: "human" } } }, options)).toThrow(expect.objectContaining({ code: "annotation_bundle_rejected" }));
	expect(() => buildEvaluationScorecard({ ...loaded, reviews: { ...loaded.reviews, reviewer: { id: "detached-reviewer", kind: "human" } } }, options)).toThrow(expect.objectContaining({ code: "review_bundle_rejected" }));
	const detachedManifest = { ...loaded.corpus, manifest: { ...loaded.corpus.manifest, id: "detached-corpus" } };
	expect(() => buildEvaluationScorecard({ ...loaded, corpus: detachedManifest }, options)).toThrow(expect.objectContaining({ code: "corpus_binding_mismatch" }));
}, 30_000);
