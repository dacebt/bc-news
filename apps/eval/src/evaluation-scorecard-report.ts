import { AnnotationBundleSchema, QualitativeReviewBundleSchema, type EvaluationScorecardArtifact } from "./evaluation-scorecard";

const QUALITATIVE_CRITERION_LABELS = [
	"coherence: internally understandable organization and relationships",
	"usefulness: useful source-grounded information for a regional reader",
	"newsworthiness: human judgment that included material is worth reporting, without requiring one target angle",
	"voice: adherence to the declared in-world straightforward editorial voice",
] as const;

function exactEvidence(value: object): string {
	return JSON.stringify(value, null, 2);
}

export function formatEvaluationScorecardReport(artifact: EvaluationScorecardArtifact): string {
	const annotations = AnnotationBundleSchema.parse(JSON.parse(
		Buffer.from(artifact.source_payloads.annotation_bundle_base64, "base64").toString("utf8"),
	) as unknown);
	const reviews = QualitativeReviewBundleSchema.parse(JSON.parse(
		Buffer.from(artifact.source_payloads.qualitative_review_bundle_base64, "base64").toString("utf8"),
	) as unknown);
	return [
		`Evaluation scorecard v${String(artifact.version)}: ${artifact.id}`,
		`Created at: ${artifact.created_at}`,
		`Corpus: ${artifact.corpus.id} | sha256=${artifact.corpus.manifest_sha256} | fixtures=${String(artifact.corpus.fixture_count)}`,
		`Configuration: ${artifact.configuration.identity}`,
		`Repetition count: ${String(artifact.repetition_count)}`,
		`Annotation protocol: ${annotations.protocol.id} v${String(annotations.protocol.version)}`,
		`Human annotator: ${annotations.annotator.id} (${annotations.annotator.kind})`,
		`Annotated at: ${annotations.annotated_at}`,
		`Qualitative reviewer: ${reviews.reviewer.id} (${reviews.reviewer.kind})`,
		`Qualitative rubric: ${reviews.rubric.id} v${String(reviews.rubric.version)}`,
		...QUALITATIVE_CRITERION_LABELS.map((label) => `Qualitative criterion — ${label}`),
		"Benchmark Run evidence:",
		exactEvidence(artifact.benchmark_run_hashes),
		...artifact.scorecards.flatMap((scorecard) => [
			"",
			`Scorecard role: ${scorecard.production_step}`,
			"Ordered annotation evidence:",
			exactEvidence(annotations.outputs.filter(({ output }) => output.production_step === scorecard.production_step)),
			"Exact role evidence:",
			exactEvidence(scorecard),
		]),
	].join("\n");
}
