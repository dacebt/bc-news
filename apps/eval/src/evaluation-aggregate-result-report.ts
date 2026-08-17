import type { AnyEvaluationAggregateResult, EvaluationAggregateResult } from "./evaluation-aggregate-result";

function formatSubject(subject: EvaluationAggregateResult["roles"][number]["subject"]): string {
	const fields = [`adapter=${subject.adapter}`];
	if ("provider" in subject) fields.push(`provider=${subject.provider}`);
	if ("model" in subject) fields.push(`model=${subject.model}`);
	if ("temperature" in subject) fields.push(`temperature=${String(subject.temperature)}`);
	if ("reasoning_effort" in subject) fields.push(`reasoning_effort=${subject.reasoning_effort}`);
	return fields.join(" | ");
}

function formatRate(rate: EvaluationAggregateResult["roles"][number]["rates"][number]): string {
	if (rate.state === "measured") {
		return `${rate.metric}: ${String(rate.numerator)}/${String(rate.denominator)} = ${rate.value.toFixed(4)} (${rate.interval.method} ${rate.interval.lower.toFixed(4)}-${rate.interval.upper.toFixed(4)})`;
	}
	return `${rate.metric}: not_applicable (${rate.reason})`;
}

function formatDistribution(distribution: EvaluationAggregateResult["roles"][number]["distributions"][number]): string {
	const accounting = `samples=${String(distribution.sample_count)} | observed=${String(distribution.observed_sample_count)} | unavailable=${String(distribution.unavailable_sample_count)}`;
	if (distribution.summary.state === "unavailable") return `${distribution.metric}: ${accounting} | summary=unavailable`;
	return `${distribution.metric}: ${accounting} | min=${String(distribution.summary.min)} median=${String(distribution.summary.median)} mean=${String(distribution.summary.mean)} max=${String(distribution.summary.max)}`;
}

function formatQualitative(qualitative: EvaluationAggregateResult["roles"][number]["qualitative"][number]): string {
	return `${qualitative.criterion}: samples=${String(qualitative.sample_count)} | meets=${String(qualitative.counts.meets)} partly_meets=${String(qualitative.counts.partly_meets)} does_not_meet=${String(qualitative.counts.does_not_meet)} uncertain=${String(qualitative.counts.uncertain)}`;
}

function cohortLine(aggregate: AnyEvaluationAggregateResult): string {
	const fields = [
		`id=${aggregate.cohort.id}`,
		`fixtures=${String(aggregate.cohort.fixture_count)}`,
		`repetitions=${String(aggregate.cohort.repetition_count)}`,
	];
	if (aggregate.version === 2) fields.push(`evidence_identity_sha256=${aggregate.cohort.evidence_identity_sha256}`);
	if (aggregate.cohort.raw_message_count !== undefined) fields.push(`raw_messages=${String(aggregate.cohort.raw_message_count)}`);
	if (aggregate.cohort.prepared_message_count !== undefined) fields.push(`prepared_messages=${String(aggregate.cohort.prepared_message_count)}`);
	return fields.join(" | ");
}

export function formatEvaluationAggregateResultReport(aggregate: AnyEvaluationAggregateResult): string {
	return [
		`Evaluation aggregate result v${String(aggregate.version)}: ${aggregate.id}`,
		`Created at: ${aggregate.created_at}`,
		`Evidence retention: ${aggregate.evidence_retention}`,
		`Source scorecard: v${String(aggregate.source_scorecard.version)} ${aggregate.source_scorecard.id} created ${aggregate.source_scorecard.created_at}`,
		`Cohort: ${cohortLine(aggregate)}`,
		`Configuration identity: ${aggregate.configuration_identity}`,
		...aggregate.roles.flatMap((role) => [
			"",
			`Role: ${role.production_step}`,
			`Subject: ${formatSubject(role.subject)}`,
			"Sample counts:",
			...Object.entries(role.sample_counts).map(([key, value]) => `- ${key}: ${String(value)}`),
			"Rates:",
			...role.rates.map((rate) => `- ${formatRate(rate)}`),
			"Distributions:",
			...role.distributions.map((distribution) => `- ${formatDistribution(distribution)}`),
			"Qualitative:",
			...role.qualitative.map((qualitative) => `- ${formatQualitative(qualitative)}`),
		]),
	].join("\n");
}
