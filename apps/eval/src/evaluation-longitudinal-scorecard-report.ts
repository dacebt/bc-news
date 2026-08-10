import type { EvaluationLongitudinalScorecardArtifact } from "./evaluation-longitudinal-scorecard";

function exactEvidence(value: object): string {
	return JSON.stringify(value, null, 2);
}

export function formatEvaluationLongitudinalScorecardReport(
	artifact: EvaluationLongitudinalScorecardArtifact,
): string {
	return [
		`Longitudinal evaluation scorecard series v${String(artifact.version)}: ${artifact.id}`,
		`Created at: ${artifact.created_at}`,
		`Evidence minimum: baseline=${String(artifact.policy.minimum_baseline_scorecards)} scorecards | subject=${String(artifact.policy.minimum_subject_scorecards)} scorecards`,
		`Rate uncertainty: ${String(artifact.policy.rate_interval.confidence * 100)}% ${artifact.policy.rate_interval.method} | z=${String(artifact.policy.rate_interval.z)}`,
		`Rate signal method: ${artifact.policy.rate_signal_method}`,
		`Distribution signal method: ${artifact.policy.distribution_signal_method}`,
		`Classifier precedence: ${artifact.policy.classifier_precedence.join(" -> ")}`,
		"Source scorecard audit packs:",
		exactEvidence(artifact.scorecard_hashes),
		...artifact.roles.flatMap((role) => [
			"",
			`Longitudinal role: ${role.production_step}`,
			`Partitions: baseline=${String(role.baseline_pack_count)} | subject=${String(role.subject_pack_count)}`,
			`Classification: ${role.classification.state}`,
			"Exact role history:",
			exactEvidence(role),
		]),
	].join("\n");
}
