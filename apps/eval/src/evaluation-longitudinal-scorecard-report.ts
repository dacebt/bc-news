import type { AnyEvaluationLongitudinalScorecardArtifact } from "./evaluation-longitudinal-scorecard";
import type { LongitudinalFreshness } from "./evaluation-longitudinal-scorecard-store";

function exactEvidence(value: object): string { return JSON.stringify(value, null, 2); }

export function formatEvaluationLongitudinalScorecardReport(artifact: AnyEvaluationLongitudinalScorecardArtifact, freshness?: readonly LongitudinalFreshness[]): string {
	if (artifact.version === 1) return [
		`Longitudinal evaluation scorecard series v1: ${artifact.id}`,
		`Created at: ${artifact.created_at}`,
		`Evidence minimum: baseline=${String(artifact.policy.minimum_baseline_scorecards)} scorecards | subject=${String(artifact.policy.minimum_subject_scorecards)} scorecards`,
		`Rate uncertainty: ${String(artifact.policy.rate_interval.confidence * 100)}% ${artifact.policy.rate_interval.method} | z=${String(artifact.policy.rate_interval.z)}`,
		`Rate signal method: ${artifact.policy.rate_signal_method}`,
		`Distribution signal method: ${artifact.policy.distribution_signal_method}`,
		`Classifier precedence: ${artifact.policy.classifier_precedence.join(" -> ")}`,
		"Source scorecard audit packs:",
		exactEvidence(artifact.scorecard_hashes),
		...artifact.roles.flatMap((role) => ["", `Longitudinal role: ${role.production_step}`, `Partitions: baseline=${String(role.baseline_pack_count)} | subject=${String(role.subject_pack_count)}`, `Classification: ${role.classification.state}`, "Exact role history:", exactEvidence(role)]),
	].join("\n");
	if (artifact.version === 2) return [
		`Longitudinal evaluation scorecard series v2: ${artifact.id}`,
		`Created at: ${artifact.created_at}`,
		`Source: ${artifact.source_reference.commit_sha}:${artifact.source_reference.path}`,
		`Evidence minimum: baseline=${String(artifact.policy.minimum_baseline_scorecards)} scorecards | subject=${String(artifact.policy.minimum_subject_scorecards)} scorecards`,
		`Rate uncertainty: ${String(artifact.policy.rate_interval.confidence * 100)}% ${artifact.policy.rate_interval.method} | z=${String(artifact.policy.rate_interval.z)}`,
		`Rate signal method: ${artifact.policy.rate_signal_method}`,
		`Distribution signal method: ${artifact.policy.distribution_signal_method}`,
		`Classifier precedence: ${artifact.policy.classifier_precedence.join(" -> ")}`,
		"Source scorecard references:",
		exactEvidence(artifact.scorecard_references),
		"Evaluated code freshness:",
		exactEvidence(freshness ?? []),
		...artifact.roles.flatMap((role) => ["", `Longitudinal role: ${role.production_step}`, `Partitions: baseline=${String(role.baseline_pack_count)} | subject=${String(role.subject_pack_count)}`, `Classification: ${role.classification.state}`, "Exact role history:", exactEvidence(role)]),
	].join("\n");
	return [
		`Longitudinal evaluation scorecard series v3: ${artifact.id}`,
		`Created at: ${artifact.created_at}`,
		`Source local data: ${artifact.source_reference.path} | sha256=${artifact.source_reference.sha256}`,
		`Evidence minimum: baseline=${String(artifact.policy.minimum_baseline_scorecards)} scorecards | subject=${String(artifact.policy.minimum_subject_scorecards)} scorecards`,
		`Rate uncertainty: ${String(artifact.policy.rate_interval.confidence * 100)}% ${artifact.policy.rate_interval.method} | z=${String(artifact.policy.rate_interval.z)}`,
		`Rate signal method: ${artifact.policy.rate_signal_method}`,
		`Distribution signal method: ${artifact.policy.distribution_signal_method}`,
		`Classifier precedence: ${artifact.policy.classifier_precedence.join(" -> ")}`,
		"Source scorecard references:",
		exactEvidence(artifact.scorecard_references),
		"Evaluated code freshness:",
		exactEvidence(freshness ?? []),
		...artifact.roles.flatMap((role) => ["", `Longitudinal role: ${role.production_step}`, `Partitions: baseline=${String(role.baseline_pack_count)} | subject=${String(role.subject_pack_count)}`, `Classification: ${role.classification.state}`, "Exact role history:", exactEvidence(role)]),
	].join("\n");
}
