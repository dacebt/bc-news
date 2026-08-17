import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { PRODUCTION_MODEL_STEPS, type ProductionModelStep } from "@bc-news/generation-core";
import { canonical } from "./evaluation-artifact-schemas";
import { validateLoadedEvaluationLongitudinalInputV2, type LoadedEvaluationLongitudinalInputV2 } from "./evaluation-longitudinal-scorecard-input-v2";
import { EvaluationLongitudinalError } from "./evaluation-longitudinal-scorecard";
import {
	EvaluationLongitudinalRoleHistoryV2Schema,
	EvaluationLongitudinalScorecardArtifactV2Schema,
	type EvaluationLongitudinalRoleHistoryV2,
	type EvaluationLongitudinalScorecardArtifactV2,
	type StableLongitudinalContextV2,
} from "./evaluation-longitudinal-scorecard-v2";
import type { EvaluationRoleScorecard, EvaluationScorecardArtifact } from "./evaluation-scorecard-v2";

const COUNT_NAMES = ["declared_trial_count", "step_reached_trial_count", "step_not_reached_trial_count", "invocation_attempt_count", "initial_attempt_count", "retry_attempt_count", "transport_failed_attempt_count", "transport_succeeded_attempt_count", "parse_succeeded_invocation_count", "parse_rejected_invocation_count", "annotated_output_count", "reviewed_output_count"] as const;
const RATE_NAMES = ["schema_reliability", "copyedit_preservation", "claim_grounding", "required_attribution", "event_coverage", "announcement_relevance"] as const;
const DISTRIBUTION_NAMES = ["input_tokens", "output_tokens", "total_tokens", "application_latency_ms", "provider_time_to_first_token_ms", "provider_total_time_ms"] as const;
const CRITERIA = ["coherence", "usefulness", "newsworthiness", "voice"] as const;
const Z95 = 1.959963984540054;

function fail(code: EvaluationLongitudinalError["code"], path: string, message: string): never { throw new EvaluationLongitudinalError(code, path, message); }
function hash(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
function identity(value: unknown): string { return `longitudinal-context-${hash(Buffer.from(JSON.stringify(canonical(value))))}`; }
function sourceIdentity(source: LoadedEvaluationLongitudinalInputV2["scorecards"][number]) {
	return {
		ordinal: source.descriptor.ordinal, phase: source.descriptor.phase, scorecard_id: source.artifact.id,
		source_reference: source.descriptor.source_reference, created_at: source.artifact.created_at,
		provenance: {
			annotation: { protocol_id: "bc-news-output-annotation" as const, protocol_version: 2 as const, annotator_id: source.annotationProvenance.annotatorId, annotator_kind: "codex" as const, annotated_at: source.annotationProvenance.annotatedAt },
			review: { rubric_id: "bc-news-editorial-qualitative" as const, rubric_version: 2 as const, reviewer_id: source.annotationProvenance.reviewerId, reviewer_kind: "codex" as const, reviewed_at: source.annotationProvenance.reviewedAt },
		},
	};
}

function retainedRetryLimit(scorecard: EvaluationScorecardArtifact): number {
	const limits = new Set(scorecard.sources.benchmark_runs.map(({ transport_retry_limit }) => transport_retry_limit));
	if (limits.size !== 1) fail("cohort_projection_invalid", scorecard.id, "Source scorecard contains differing retry policies");
	return [...limits][0]!;
}

export function projectLongitudinalRoleContextV2(scorecard: EvaluationScorecardArtifact, productionStep: ProductionModelStep): StableLongitudinalContextV2 {
	const role = scorecard.scorecards.find(({ production_step }) => production_step === productionStep);
	if (role === undefined) fail("longitudinal_evidence_set_mismatch", scorecard.id, `Missing role ${productionStep}`);
	if (role.scorecard_context.state === "unknown") return { state: "unknown", reason: "no_captured_invocation" };
	const groups = new Map<string, string>();
	for (const request of role.scorecard_context.projection.request_hashes) {
		const key = `${request.run_id}\0${request.trial_id}`; const previous = groups.get(key);
		if (previous !== undefined && previous !== request.request_sha256) fail("cohort_projection_invalid", scorecard.id, `Retry request hashes differ for ${productionStep}`);
		if (previous === undefined) groups.set(key, request.request_sha256);
	}
	const source = role.scorecard_context.projection;
	const projection = {
		scorecard_version: 2 as const, corpus_manifest_id: source.corpus_manifest_id,
		corpus_source_reference: source.corpus_source_reference,
		ordered_fixture_prepared_identities: source.fixture_prepared_identities,
		code_provenance: source.code_provenance, ordered_output_contract_provenance: source.output_contract_provenance,
		adapter: source.adapter, declared_transport_retry_limit: retainedRetryLimit(scorecard),
		ordered_requests: [...groups.values()].map((request_sha256, index) => ({ observation_ordinal: index + 1, request_sha256 })),
		normalized_execution_context: source.execution_context,
	};
	return { state: "identified", identity: identity(projection), projection };
}

function roleOf(source: LoadedEvaluationLongitudinalInputV2["scorecards"][number], step: ProductionModelStep): EvaluationRoleScorecard {
	const role = source.artifact.scorecards.find(({ production_step }) => production_step === step);
	if (role === undefined) return fail("longitudinal_evidence_set_mismatch", source.artifact.id, `Missing role ${step}`);
	return role;
}

function valueAt(value: unknown, segments: readonly (string | number)[]): { state: "present"; value: unknown } | { state: "missing" } {
	let cursor: unknown = value;
	for (const segment of segments) {
		if (cursor === null || typeof cursor !== "object" || !Object.hasOwn(cursor, segment)) return { state: "missing" };
		cursor = (cursor as Record<string | number, unknown>)[segment];
	}
	return { state: "present", value: cursor };
}

function differingPaths(left: unknown, right: unknown, path = "projection", segments: readonly (string | number)[] = []): Array<{ path: string; segments: readonly (string | number)[] }> {
	if (isDeepStrictEqual(left, right)) return [];
	if (Array.isArray(left) && Array.isArray(right)) {
		const paths: Array<{ path: string; segments: readonly (string | number)[] }> = left.length === right.length ? [] : [{ path: `${path}.length`, segments: [...segments, "length"] }];
		for (let index = 0; index < Math.max(left.length, right.length); index += 1) paths.push(...differingPaths(left[index], right[index], `${path}[${String(index)}]`, [...segments, index]));
		return paths;
	}
	if (left !== null && right !== null && typeof left === "object" && typeof right === "object") {
		return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort().flatMap((key) => differingPaths((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key], `${path}.${key}`, [...segments, key]));
	}
	return [{ path, segments }];
}

export function compareLongitudinalContextsV2(
	sources: readonly { readonly scorecardId: string; readonly ordinal: number }[],
	contexts: readonly StableLongitudinalContextV2[],
) {
	const referenceIndex = contexts.findIndex(({ state }) => state === "identified");
	if (referenceIndex < 0) return [];
	const reference = contexts[referenceIndex]!; if (reference.state !== "identified") return [];
	return contexts.flatMap((context, index) => {
		if (index === referenceIndex || context.state !== "identified") return [];
		return differingPaths(reference.projection, context.projection).map(({ path, segments }) => ({
				reference_scorecard_id: sources[referenceIndex]!.scorecardId, compared_scorecard_id: sources[index]!.scorecardId,
				compared_ordinal: sources[index]!.ordinal, path,
			reference_value: valueAt(reference.projection, segments), compared_value: valueAt(context.projection, segments),
		}));
	}).sort((left, right) => left.compared_ordinal - right.compared_ordinal || left.path.localeCompare(right.path));
}

export function classifyLongitudinalEvidenceV2(
	contexts: readonly StableLongitudinalContextV2[],
	differences: ReturnType<typeof compareLongitudinalContextsV2>,
	baselinePackCount: number,
	subjectPackCount: number,
	witnesses: EvaluationLongitudinalRoleHistoryV2["eligible_signal_witnesses"],
): EvaluationLongitudinalRoleHistoryV2["classification"] {
	const contextIds = unique(contexts.flatMap((context) => context.state === "identified" ? [context.identity] : []));
	const insufficient = unique([...(contexts.some(({ state }) => state === "unknown") ? ["unidentified_context" as const] : []), ...(baselinePackCount < 3 ? ["baseline_below_minimum" as const] : []), ...(subjectPackCount < 2 ? ["subject_below_minimum" as const] : []), ...(witnesses.length === 0 ? ["no_eligible_quantitative_measurement" as const] : [])]);
	return contextIds.length >= 2
		? { state: "context_changed", context_identities: contextIds, differences }
		: insufficient.length > 0
			? { state: "insufficient_evidence", reasons: insufficient }
			: witnesses.some(({ observed }) => observed)
				? { state: "potential_drift", signal_witnesses: witnesses.filter(({ observed }) => observed) }
				: { state: "within_baseline", signal_witnesses: witnesses };
}

function wilson(numerator: number, denominator: number) {
	const p = numerator / denominator; const z2 = Z95 ** 2; const divisor = 1 + z2 / denominator;
	const center = (p + z2 / (2 * denominator)) / divisor;
	const margin = Z95 * Math.sqrt((p * (1 - p) + z2 / (4 * denominator)) / denominator) / divisor;
	return { confidence: 0.95 as const, method: "wilson_score" as const, lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) };
}
function summary(values: readonly number[]) {
	if (values.length === 0) return { state: "unavailable" as const };
	const sorted = [...values].sort((left, right) => left - right); const middle = Math.floor(sorted.length / 2);
	return { state: "measured" as const, min: sorted[0]!, median: sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!, mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length, max: sorted.at(-1)! };
}
function unique<T>(values: readonly T[]): T[] { return [...new Set(values)]; }
function qualitativeSource(identityValue: ReturnType<typeof sourceIdentity>, value: EvaluationRoleScorecard["qualitative"][number]) {
	return { ...identityValue, sample_count: value.sample_count, counts: value.counts, evidence: value.evidence };
}

function buildRole(input: LoadedEvaluationLongitudinalInputV2, step: ProductionModelStep): EvaluationLongitudinalRoleHistoryV2 {
	const sources = input.scorecards; const roles = sources.map((source) => roleOf(source, step)); const contexts = input.stableRoleContexts.map((entry) => entry[step]);
	const identities = sources.map(sourceIdentity); const baselineIndexes = sources.flatMap((source, index) => source.descriptor.phase === "baseline" ? [index] : []); const subjectIndexes = sources.flatMap((source, index) => source.descriptor.phase === "subject" ? [index] : []);
	const phaseTotals = (indexes: readonly number[]) => Object.fromEntries(COUNT_NAMES.map((name) => [name, indexes.reduce((sum, index) => sum + roles[index]!.sample_counts[name]!, 0)]));
	const countHistories = COUNT_NAMES.map((metric) => ({ metric, unit: "count" as const, sources: sources.map((source, index) => ({ ...identities[index]!, value: roles[index]!.sample_counts[metric]! })), baseline_total: baselineIndexes.reduce((sum, index) => sum + roles[index]!.sample_counts[metric]!, 0), subject_total: subjectIndexes.reduce((sum, index) => sum + roles[index]!.sample_counts[metric]!, 0) }));
	const rateHistories = RATE_NAMES.map((metric, metricIndex) => {
		const measurements = roles.map((role) => role.rates[metricIndex]!); const first = measurements[0]!;
		const phase = (indexes: readonly number[]) => {
			const selected = indexes.map((index) => measurements[index]!); const numerator = selected.reduce((sum, item) => sum + item.numerator, 0); const denominator = selected.reduce((sum, item) => sum + item.denominator, 0);
			return { source_pack_count: indexes.length, observations: indexes.map((index) => ({ ...identities[index]!, measurement: measurements[index]! })), pool: denominator === 0 ? { state: "not_applicable" as const, numerator, denominator: 0 as const, sample_count: 0 as const, reason: "zero_pooled_denominator" as const } : { state: "measured" as const, numerator, denominator, sample_count: denominator, value: numerator / denominator, interval: wilson(numerator, denominator) } };
		};
		const contractMismatch = measurements.some((item) => item.metric !== first.metric || item.unit !== first.unit || item.denominator_unit !== first.denominator_unit);
		const reasons = unique([...(contractMismatch ? ["metric_contract_mismatch" as const] : []), ...(measurements.some(({ state }) => state !== "measured") ? ["source_not_measured" as const] : []), ...(measurements.some(({ denominator }) => denominator === 0) ? ["zero_denominator" as const] : [])]);
		const baseline = phase(baselineIndexes); const subject = phase(subjectIndexes); const eligible = reasons.length === 0;
		const signal = eligible && baseline.pool.state === "measured" && subject.pool.state === "measured" && (baseline.pool.interval.upper < subject.pool.interval.lower || subject.pool.interval.upper < baseline.pool.interval.lower);
		return { metric, unit: "ratio" as const, denominator_unit: first.denominator_unit, baseline, subject, eligibility: eligible ? { state: "eligible" as const } : { state: "ineligible" as const, reasons }, signal_observed: signal, method: "strict_wilson_interval_disjointness" as const };
	});
	const distributionHistories = DISTRIBUTION_NAMES.map((metric, metricIndex) => {
		const measurements = roles.map((role) => role.distributions[metricIndex]!); const first = measurements[0]!;
		const phase = (indexes: readonly number[]) => {
			const selected = indexes.map((index) => ({ index, value: measurements[index]! }));
			const samples = selected.flatMap(({ index, value }) => value.samples.map((sample) => ({ source_scorecard_id: sources[index]!.artifact.id, source_scorecard_reference: sources[index]!.descriptor.source_reference, ...sample })));
			return { source_pack_count: indexes.length, sources: selected.map(({ index, value }) => ({ ...identities[index]!, sample_count: value.sample_count, observed_sample_count: value.observed_sample_count, unavailable_sample_count: value.unavailable_sample_count })), sample_count: selected.reduce((sum, { value }) => sum + value.sample_count, 0), observed_sample_count: selected.reduce((sum, { value }) => sum + value.observed_sample_count, 0), unavailable_sample_count: selected.reduce((sum, { value }) => sum + value.unavailable_sample_count, 0), samples, summary: summary(samples.map(({ value }) => value)) };
		};
		const baseline = phase(baselineIndexes); const subject = phase(subjectIndexes); const reasons = unique([...(measurements.some((item) => item.metric !== first.metric || item.unit !== first.unit) ? ["metric_contract_mismatch" as const] : []), ...(measurements.some(({ observed_sample_count }) => observed_sample_count === 0) ? ["source_without_observation" as const] : []), ...(baseline.observed_sample_count < 3 ? ["baseline_below_minimum_observations" as const] : []), ...(subject.observed_sample_count < 2 ? ["subject_below_minimum_observations" as const] : [])]);
		const eligible = reasons.length === 0; const signal = eligible && baseline.summary.state === "measured" && subject.summary.state === "measured" && (baseline.summary.max < subject.summary.min || subject.summary.max < baseline.summary.min);
		return { metric, unit: first.unit, baseline, subject, eligibility: eligible ? { state: "eligible" as const } : { state: "ineligible" as const, reasons }, signal_observed: signal, method: "strict_observed_range_disjointness" as const };
	});
	const qualitativeHistories = CRITERIA.map((criterion, criterionIndex) => ({ criterion, unit: "review_assessment" as const, sample_unit: "codex_reviewed_output" as const, baseline: baselineIndexes.map((index) => qualitativeSource(identities[index]!, roles[index]!.qualitative[criterionIndex]!)), subject: subjectIndexes.map((index) => qualitativeSource(identities[index]!, roles[index]!.qualitative[criterionIndex]!)) }));
	const differences = compareLongitudinalContextsV2(sources.map((source) => ({ scorecardId: source.artifact.id, ordinal: source.descriptor.ordinal })), contexts);
	const witnesses = [
		...rateHistories.flatMap((history) => history.eligibility.state === "eligible" && history.baseline.pool.state === "measured" && history.subject.pool.state === "measured" ? [{ kind: "rate" as const, metric: history.metric, method: history.method, baseline_interval: { lower: history.baseline.pool.interval.lower, upper: history.baseline.pool.interval.upper }, subject_interval: { lower: history.subject.pool.interval.lower, upper: history.subject.pool.interval.upper }, observed: history.signal_observed }] : []),
		...distributionHistories.flatMap((history) => history.eligibility.state === "eligible" && history.baseline.summary.state === "measured" && history.subject.summary.state === "measured" ? [{ kind: "distribution" as const, metric: history.metric, method: history.method, baseline_range: { min: history.baseline.summary.min, max: history.baseline.summary.max }, subject_range: { min: history.subject.summary.min, max: history.subject.summary.max }, observed: history.signal_observed }] : []),
	];
	const classification = classifyLongitudinalEvidenceV2(contexts, differences, baselineIndexes.length, subjectIndexes.length, witnesses);
	return { production_step: step, baseline_pack_count: baselineIndexes.length, subject_pack_count: subjectIndexes.length, sources: sources.map((source, index) => ({ ...identities[index]!, context: contexts[index]! })), stable_contexts: contexts, context_differences: differences, phase_count_summaries: { baseline: phaseTotals(baselineIndexes), subject: phaseTotals(subjectIndexes) }, count_histories: countHistories, rate_histories: rateHistories, distribution_histories: distributionHistories, qualitative_histories: qualitativeHistories, eligible_signal_witnesses: witnesses, classification };
}

export function buildEvaluationLongitudinalScorecardV2(input: LoadedEvaluationLongitudinalInputV2, options: { readonly id: string; readonly createdAt: string }): EvaluationLongitudinalScorecardArtifactV2 {
	input = validateLoadedEvaluationLongitudinalInputV2(input);
	if (Date.parse(options.createdAt) < Math.max(...input.scorecards.map(({ artifact }) => Date.parse(artifact.created_at)))) fail("longitudinal_chronology_mismatch", input.declarationPath, "Series creation cannot predate a source scorecard");
	const candidate = {
		version: 2 as const, id: options.id, created_at: options.createdAt,
		policy: { minimum_baseline_scorecards: 3 as const, minimum_subject_scorecards: 2 as const, rate_interval: { confidence: 0.95 as const, method: "wilson_score" as const, z: Z95 }, rate_signal_method: "strict_wilson_interval_disjointness" as const, distribution_signal_method: "strict_observed_range_disjointness" as const, classifier_precedence: ["context_changed", "insufficient_evidence", "potential_drift", "within_baseline"] as const },
		source_reference: input.sourceReference,
		scorecard_references: input.scorecards.map(({ descriptor, artifact }) => {
			const commits = [...new Set(artifact.sources.benchmark_runs.map(({ code_commit_sha }) => code_commit_sha))];
			if (commits.length !== 1) return fail("cohort_projection_invalid", artifact.id, "Source scorecard contains more than one evaluated code commit");
			return { ordinal: descriptor.ordinal, phase: descriptor.phase, scorecard_id: descriptor.scorecard_id, source_reference: descriptor.source_reference, evaluated_code_commit_sha: commits[0]!, created_at: artifact.created_at };
		}),
		roles: PRODUCTION_MODEL_STEPS.map((step) => buildRole(input, step)),
	};
	for (const role of candidate.roles) {
		const roleResult = EvaluationLongitudinalRoleHistoryV2Schema.safeParse(role);
		if (!roleResult.success) fail("longitudinal_evidence_set_mismatch", input.declarationPath, `Built role history violated its contract: ${roleResult.error.message}`);
	}
	const result = EvaluationLongitudinalScorecardArtifactV2Schema.safeParse(candidate);
	if (!result.success) fail("longitudinal_evidence_set_mismatch", input.declarationPath, `Built longitudinal scorecard violated its contract: ${result.error.message}`);
	return result.data;
}
