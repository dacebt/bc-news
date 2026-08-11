import type { EvaluationFreshness } from "./evaluation-repository-reference";
import {
	AnnotationBundleV1Schema,
	QualitativeReviewBundleV1Schema,
	type AnyEvaluationScorecardArtifact,
	type EvaluationScorecardArtifactV1,
} from "./evaluation-scorecard";

const QUALITATIVE_CRITERION_LABELS = [
	"coherence: internally understandable organization and relationships",
	"usefulness: useful source-grounded information for a regional reader",
	"newsworthiness: Codex assessment that included material is worth reporting, without requiring one target angle",
	"voice: adherence to the declared in-world straightforward editorial voice",
] as const;

function exactEvidence(value: object): string { return JSON.stringify(value, null, 2); }

export function formatEvaluationScorecardReport(artifact: AnyEvaluationScorecardArtifact, freshness?: EvaluationFreshness): string {
	if (artifact.version === 1) return formatEvaluationScorecardReportV1(artifact);
	if (freshness === undefined) throw new Error("Current scorecard report requires evaluated-code freshness");
	return [
		`Evaluation scorecard v${String(artifact.version)}: ${artifact.id}`,
		`Created at: ${artifact.created_at}`,
		`Source: ${artifact.source_reference.commit_sha}:${artifact.source_reference.path}`,
		`Evaluated code: ${freshness.evaluated_commit_sha} | checkout=${freshness.checkout_commit_sha} | freshness=${freshness.state}`,
		`Corpus: ${artifact.corpus.id} | fixtures=${String(artifact.corpus.fixture_count)}`,
		`Configuration: ${artifact.configuration.identity}`,
		`Repetition count: ${String(artifact.repetition_count)}`,
		`Annotation protocol: ${artifact.sources.annotations.protocol_id}`,
		`Codex annotator: ${artifact.sources.annotations.annotator_id} (${artifact.sources.annotations.annotator_kind})`,
		`Annotated at: ${artifact.sources.annotations.annotated_at}`,
		`Codex qualitative reviewer: ${artifact.sources.qualitative_reviews.reviewer_id} (${artifact.sources.qualitative_reviews.reviewer_kind})`,
		`Qualitative rubric: ${artifact.sources.qualitative_reviews.rubric_id}`,
		...QUALITATIVE_CRITERION_LABELS.map((label) => `Qualitative criterion — ${label}`),
		"Benchmark Run evidence:",
		exactEvidence(artifact.sources.benchmark_runs),
		...artifact.scorecards.flatMap((scorecard) => ["", `Scorecard role: ${scorecard.production_step}`, "Exact role evidence:", exactEvidence(scorecard)]),
	].join("\n");
}

function formatEvaluationScorecardReportV1(artifact: EvaluationScorecardArtifactV1): string {
	const annotations = AnnotationBundleV1Schema.parse(JSON.parse(Buffer.from(artifact.source_payloads.annotation_bundle_base64, "base64").toString("utf8")) as unknown);
	const reviews = QualitativeReviewBundleV1Schema.parse(JSON.parse(Buffer.from(artifact.source_payloads.qualitative_review_bundle_base64, "base64").toString("utf8")) as unknown);
	return [
		`Evaluation scorecard v1: ${artifact.id}`,
		`Created at: ${artifact.created_at}`,
		`Corpus: ${artifact.corpus.id} | sha256=${artifact.corpus.manifest_sha256} | fixtures=${String(artifact.corpus.fixture_count)}`,
		`Configuration: ${artifact.configuration.identity}`,
		`Repetition count: ${String(artifact.repetition_count)}`,
		`Annotation protocol: ${annotations.protocol.id} v${String(annotations.protocol.version)}`,
		`Human annotator: ${annotations.annotator.id} (${annotations.annotator.kind})`,
		`Annotated at: ${annotations.annotated_at}`,
		`Human qualitative reviewer: ${reviews.reviewer.id} (${reviews.reviewer.kind})`,
		`Qualitative rubric: ${reviews.rubric.id} v${String(reviews.rubric.version)}`,
		"Benchmark Run evidence:",
		exactEvidence(artifact.benchmark_run_hashes),
		...artifact.scorecards.flatMap((scorecard) => ["", `Scorecard role: ${scorecard.production_step}`, "Exact role evidence:", exactEvidence(scorecard)]),
	].join("\n");
}
