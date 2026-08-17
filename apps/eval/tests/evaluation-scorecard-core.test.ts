import { expect, test } from "vitest";
import {
	AnnotationBundleSchema,
	AnnotationBundleV1Schema,
	EvaluationScorecardArtifactSchema,
	EvaluationScorecardArtifactV1Schema,
	EvaluationScorecardArtifactV2Schema,
	EvaluationScorecardDeclarationSchema,
	EvaluationScorecardDeclarationV2Schema,
	OutputIdentitySchema,
	QualitativeReviewBundleSchema,
} from "../src/evaluation-scorecard";
import { RepositorySourceReferenceSchema } from "../src/evaluation-repository-reference";

const HASH = "1".repeat(64);
const LOCAL_SOURCE = { path: "apps/eval/local-data/source.json", sha256: HASH };

function outputIdentity() {
	return {
		benchmark_run_id: "benchmark-one", benchmark_run_version: 7, code_commit_sha: "2".repeat(40), prepared_evidence_identity_sha256: HASH,
		corpus_manifest_id: "corpus-one", corpus_fixture_id: "fixture-one", config_identity: "config-one", trial_id: "trial-one", repetition: 1,
		invocation_id: "invocation-one", production_step: "main_story_write", invocation_ordinal: 1, request_sha256: HASH,
		completion_text_sha256: HASH, parsed_output_sha256: HASH, runtime_evidence_sha256: HASH,
	};
}

test("keeps historical human evidence frozen while current evidence is Codex-authored", () => {
	const historical = { version: 1, protocol: { id: "bc-news-output-annotation", version: 1 }, annotator: { id: "editor", kind: "human" }, annotated_at: "2026-08-10T12:00:00.000Z", outputs: [] };
	expect(AnnotationBundleV1Schema.safeParse(historical).success).toBe(true);
	expect(AnnotationBundleSchema.safeParse(historical).success).toBe(false);
	const current = { version: 2, id: "annotations-one", protocol: { id: "bc-news-output-annotation", version: 2 }, annotator: { id: "codex", kind: "codex" }, annotated_at: "2026-08-10T12:00:00.000Z", outputs: [] };
	expect(AnnotationBundleSchema.safeParse(current).success).toBe(true);
	expect(QualitativeReviewBundleSchema.safeParse({ version: 2, id: "reviews-one", rubric: { id: "bc-news-editorial-qualitative", version: 2 }, reviewer: { id: "codex", kind: "codex" }, reviewed_at: "2026-08-10T12:00:00.000Z", reviews: [] }).success).toBe(true);
});

test("keeps repository references strict for historical V2 scorecards", () => {
	expect(RepositorySourceReferenceSchema.safeParse({ repository: "bc-news", commit_sha: "a".repeat(40), path: "evidence/scorecard.json" }).success).toBe(true);
	for (const path of ["/absolute.json", "../escape.json", "evidence/../escape.json", "evidence\\escape.json", "evidence//escape.json"]) expect(RepositorySourceReferenceSchema.safeParse({ repository: "bc-news", commit_sha: "a".repeat(40), path }).success).toBe(false);
	expect(RepositorySourceReferenceSchema.safeParse({ repository: "bc-news", commit_sha: "short", path: "evidence.json" }).success).toBe(false);
});

test("current output identities retain semantic hashes but no recursive source hashes", () => {
	const parsed = OutputIdentitySchema.parse(outputIdentity());
	expect(parsed.request_sha256).toBe(HASH);
	expect(parsed).not.toHaveProperty("benchmark_run_sha256");
	expect(parsed).not.toHaveProperty("fixture_sha256");
	expect(parsed).not.toHaveProperty("reference_sha256");
});

test("version 8 output identities require exact Gateway-request evidence", () => {
	const gatewayIdentity = { ...outputIdentity(), benchmark_run_version: 8, gateway_request_sha256: HASH };
	expect(OutputIdentitySchema.safeParse(gatewayIdentity).success).toBe(true);
	expect(OutputIdentitySchema.safeParse({ ...outputIdentity(), benchmark_run_version: 8 }).success).toBe(false);
	expect(OutputIdentitySchema.safeParse({ ...outputIdentity(), gateway_request_sha256: HASH }).success).toBe(false);
});

test("keeps V2 and V3 scorecard declarations separate", () => {
	const v2 = { version: 2, id: "scorecard-input", corpus: { manifest_path: "packages/fixtures/evaluation-corpus/manifest.json" }, configuration_identity: "config-one", runs: [{ ordinal: 1, corpus_fixture_id: "fixture-one", benchmark_run_id: "benchmark-one", path: "evidence/benchmark-one.json" }], annotations: { path: "evidence/annotations.json", bundle_id: "annotations-one" }, qualitative_reviews: { path: "evidence/reviews.json", bundle_id: "reviews-one" } };
	const v3 = { version: 3, id: "scorecard-input", corpus: { source_reference: { path: "apps/eval/local-data/manifest.json", sha256: HASH } }, configuration_identity: "config-one", runs: [{ ordinal: 1, corpus_fixture_id: "fixture-one", benchmark_run_id: "benchmark-one", source_reference: { path: "apps/eval/local-data/benchmark-one.json", sha256: HASH } }], annotations: { source_reference: { path: "apps/eval/local-data/annotations.json", sha256: HASH }, bundle_id: "annotations-one" }, qualitative_reviews: { source_reference: { path: "apps/eval/local-data/reviews.json", sha256: HASH }, bundle_id: "reviews-one" } };
	expect(EvaluationScorecardDeclarationV2Schema.safeParse(v2).success).toBe(true);
	expect(EvaluationScorecardDeclarationSchema.safeParse(v2).success).toBe(false);
	expect(EvaluationScorecardDeclarationSchema.safeParse(v3).success).toBe(true);
});

test("current declaration and artifact reject recursive byte ownership fields", () => {
	const declaration = { version: 3, id: "scorecard-input", corpus: { source_reference: { path: "apps/eval/local-data/manifest.json", sha256: HASH } }, configuration_identity: "config-one", runs: [{ ordinal: 1, corpus_fixture_id: "fixture-one", benchmark_run_id: "benchmark-one", source_reference: { path: "apps/eval/local-data/benchmark-one.json", sha256: HASH } }], annotations: { source_reference: { path: "apps/eval/local-data/annotations.json", sha256: HASH }, bundle_id: "annotations-one" }, qualitative_reviews: { source_reference: { path: "apps/eval/local-data/reviews.json", sha256: HASH }, bundle_id: "reviews-one" } };
	expect(EvaluationScorecardDeclarationSchema.safeParse(declaration).success).toBe(true);
	expect(EvaluationScorecardDeclarationSchema.safeParse({ ...declaration, declaration_sha256: HASH }).success).toBe(false);
	expect(EvaluationScorecardArtifactSchema.safeParse({ version: 3, id: "scorecard-one", source_payloads: {} }).success).toBe(false);
	expect(EvaluationScorecardArtifactV2Schema.safeParse({ version: 3, id: "scorecard-one", source_reference: LOCAL_SOURCE, corpus: { id: "corpus-one", fixture_count: 1, source_reference: LOCAL_SOURCE }, configuration: { identity: "config-one", exact_config: {} }, repetition_count: 1, sources: {}, scorecards: [] }).success).toBe(false);
	expect(EvaluationScorecardArtifactV1Schema.safeParse({ version: 2, id: "scorecard-one", source_payloads: {} }).success).toBe(false);
});
