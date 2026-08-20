import { isDeepStrictEqual } from "node:util";
import { type ModelExecutionContext } from "@bc-news/generation-core";
import { canonical, sha256Json } from "./evaluation-artifact-schemas";
import {
	LEGACY_PRODUCTION_MODEL_STEPS as PRODUCTION_MODEL_STEPS,
	type LegacyProductionModelStep as ProductionModelStep,
} from "./evaluation-artifact-legacy-schemas";
import { EvaluationScorecardArtifactSchema, EvaluationScorecardError, type EvaluationRoleScorecard, type EvaluationScorecardArtifact, type ScorecardContext } from "./evaluation-scorecard-v2";
import { validateLoadedEvaluationScorecardInput, type LoadedEvaluationScorecardInput, type ScorecardBenchmarkRun } from "./evaluation-scorecard-input-v2";

const RATE_DEFINITIONS = [
	["schema_reliability", "terminal_provider_success_invocation"],
	["copyedit_preservation", "parse_success_copyedit_output"],
	["claim_grounding", "codex_annotated_factual_claim"],
	["required_attribution", "codex_annotated_required_attribution_claim"],
	["event_coverage", "source_event_output_pair"],
	["announcement_relevance", "parsed_announcement"],
] as const;
const DISTRIBUTIONS = ["input_tokens", "output_tokens", "total_tokens", "application_latency_ms", "provider_time_to_first_token_ms", "provider_total_time_ms"] as const;
const CRITERIA = ["coherence", "usefulness", "newsworthiness", "voice"] as const;
const Z95 = 1.959963984540054;

function fail(code: EvaluationScorecardError["code"], path: string, message: string): never { throw new EvaluationScorecardError(code, path, message); }
function track(step: ProductionModelStep): "main_story" | "announcements" { return step.startsWith("main_story") ? "main_story" : "announcements"; }

function roleEvidence(input: LoadedEvaluationScorecardInput, step: ProductionModelStep) {
	return input.runs.flatMap((loaded) => loaded.run.trials
		.filter(({ config_identity }) => config_identity === input.declaration.configuration_identity)
		.map((trial) => ({ loaded, trial, invocations: trial.invocations.filter(({ production_step }) => production_step === step) })));
}

function contextFor(input: LoadedEvaluationScorecardInput, step: ProductionModelStep): ScorecardContext {
	const evidence = roleEvidence(input, step); const captured: ModelExecutionContext[] = [];
	for (const { loaded, invocations } of evidence) for (const invocation of invocations) {
		if (invocation.transport !== "succeeded") continue;
		const runtime = loaded.run.runtime_evidence.find(({ invocation_id }) => invocation_id === invocation.id);
		if (runtime?.state !== "captured") fail("output_identity_mismatch", loaded.run.id, `Missing captured runtime for ${invocation.id}`);
		captured.push(runtime.evidence.execution_context);
	}
	if (captured.length === 0) return { state: "unknown", reason: "no_captured_invocation" };
	if (captured.some((candidate) => !isDeepStrictEqual(candidate, captured[0]))) fail("execution_context_mismatch", input.declarationPath, `Execution context changed within ${step}`);
	const firstRun = input.runs[0]?.run; const config = firstRun?.declaration.configurations.find(({ identity }) => identity === input.declaration.configuration_identity)?.config;
	if (firstRun === undefined || config === undefined) fail("configuration_mismatch", input.declarationPath, "Selected configuration is missing");
	const projection = {
		corpus_manifest_id: input.corpus.manifest.id,
		corpus_source_reference: input.corpus.sourceReference,
		fixture_prepared_identities: input.runs.map(({ run, declaration }) => ({ fixture_id: declaration.corpus_fixture_id, prepared_evidence_identity_sha256: run.prepared_evidence.identity_sha256 })),
		code_provenance: firstRun.provenance.code,
		output_contract_provenance: firstRun.provenance.output_contracts,
		adapter: config.production_steps[step],
		declared_transport_retry_limit: firstRun.declaration.transport_retry_limit,
		request_hashes: evidence.flatMap(({ loaded, trial, invocations }) => invocations.map(({ request_sha256 }) => ({ run_id: loaded.run.id, trial_id: trial.id, request_sha256 }))),
		...(firstRun.version === 8 ? {
			gateway_request_hashes: evidence.flatMap(({ loaded, trial, invocations }) => invocations.map((invocation) => {
				if (loaded.run.version !== 8) fail("unsupported_benchmark_version", loaded.run.id, "Scorecard context cannot mix Benchmark Run versions");
				const gatewayRequest = loaded.run.gateway_requests.find(({ invocation_id }) => invocation_id === invocation.id);
				if (gatewayRequest === undefined) fail("output_identity_mismatch", loaded.run.id, `Missing Gateway-request evidence for ${invocation.id}`);
				return { run_id: loaded.run.id, trial_id: trial.id, invocation_id: invocation.id, gateway_request_sha256: sha256Json(canonical(gatewayRequest)) };
			})),
		} : {}),
		execution_context: captured[0]!,
	};
	return { state: "identified", identity: `context-${sha256Json(canonical(projection))}`, projection };
}

function counts(input: LoadedEvaluationScorecardInput, step: ProductionModelStep) {
	const evidence = roleEvidence(input, step); let reached = 0; let attempts = 0; let initial = 0; let retries = 0; let failed = 0; let succeeded = 0; let parsed = 0; let rejected = 0;
	for (const { loaded, invocations } of evidence) {
		if (invocations.length > 0) reached += 1;
		attempts += invocations.length;
		for (const [index, invocation] of invocations.entries()) {
			if (index === 0) { initial += 1; if (invocation.predecessor_invocation_id !== null) fail("denominator_mismatch", loaded.run.id, `Initial ${step} attempt has a predecessor`); }
			else { retries += 1; if (invocation.predecessor_invocation_id !== invocations[index - 1]?.id) fail("denominator_mismatch", loaded.run.id, `Retry chain is broken for ${step}`); }
			if (invocation.transport === "failed") failed += 1;
			if (invocation.transport === "succeeded") { succeeded += 1; if (invocation.parse.state === "succeeded") parsed += 1; else if (invocation.parse.state === "rejected") rejected += 1; else fail("denominator_mismatch", loaded.run.id, "Complete provider success retained a pending parse"); }
		}
	}
	const annotated = input.annotations.outputs.filter(({ output }) => output.production_step === step).length;
	const reviewed = input.reviews.reviews.filter(({ output }) => output.production_step === step).length;
	const result = { declared_trial_count: evidence.length, step_reached_trial_count: reached, step_not_reached_trial_count: evidence.length - reached, invocation_attempt_count: attempts, initial_attempt_count: initial, retry_attempt_count: retries, transport_failed_attempt_count: failed, transport_succeeded_attempt_count: succeeded, parse_succeeded_invocation_count: parsed, parse_rejected_invocation_count: rejected, annotated_output_count: annotated, reviewed_output_count: reviewed };
	if (result.declared_trial_count !== reached + result.step_not_reached_trial_count || attempts !== initial + retries || attempts !== failed + succeeded || initial !== reached || succeeded !== parsed + rejected || annotated !== parsed || reviewed !== parsed) fail("denominator_mismatch", input.declarationPath, `Sample-count equations failed for ${step}`);
	return result;
}

function wilson(numerator: number, denominator: number) {
	const p = numerator / denominator; const z2 = Z95 * Z95; const scale = 1 + z2 / denominator;
	const center = (p + z2 / (2 * denominator)) / scale;
	const margin = Z95 * Math.sqrt((p * (1 - p) + z2 / (4 * denominator)) / denominator) / scale;
	return { confidence: 0.95 as const, method: "wilson_score" as const, lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) };
}

function rate(metric: typeof RATE_DEFINITIONS[number][0], denominator_unit: typeof RATE_DEFINITIONS[number][1], context: ScorecardContext, numerator: number, denominator: number, reason?: "role_not_applicable") {
	if (reason !== undefined || denominator === 0) return { state: "not_applicable" as const, metric, unit: "ratio" as const, denominator_unit, scorecard_context: context, reason: reason ?? "zero_denominator" as const, numerator: 0 as const, denominator: 0 as const, sample_count: 0 as const, interval: { state: "not_applicable" as const } };
	if (numerator < 0 || numerator > denominator) fail("denominator_mismatch", metric, `Invalid ${metric} numerator`);
	return { state: "measured" as const, metric, unit: "ratio" as const, denominator_unit, scorecard_context: context, numerator, denominator, sample_count: denominator, value: numerator / denominator, interval: wilson(numerator, denominator) };
}

function rates(input: LoadedEvaluationScorecardInput, step: ProductionModelStep, context: ScorecardContext) {
	const evidence = roleEvidence(input, step); const annotations = input.annotations.outputs.filter(({ output }) => output.production_step === step);
	const successes = evidence.flatMap(({ invocations }) => invocations).filter(({ transport }) => transport === "succeeded");
	const copyedit = step.endsWith("copyedit"); const announcement = step.startsWith("announcements");
	const preservationNumerator = copyedit ? input.selectedOutputs.filter(({ identity }) => identity.production_step === step).filter(({ trial }) => !trial.tracks[track(step)].findings.some(({ kind, production_step }) => kind === "preservation" && production_step === step)).length : 0;
	const claims = annotations.flatMap(({ factual_claims }) => factual_claims); const required = claims.filter(({ attribution_requirement }) => attribution_requirement === "required");
	const events = annotations.flatMap(({ event_coverage }) => event_coverage);
	const announcements = annotations.flatMap((annotation) => annotation.announcement_relevance.state === "assessed" ? annotation.announcement_relevance.announcements : []);
	return [
		rate(...RATE_DEFINITIONS[0], context, successes.filter(({ parse }) => parse.state === "succeeded").length, successes.length),
		rate(...RATE_DEFINITIONS[1], context, preservationNumerator, copyedit ? input.selectedOutputs.filter(({ identity }) => identity.production_step === step).length : 0, copyedit ? undefined : "role_not_applicable"),
		rate(...RATE_DEFINITIONS[2], context, claims.filter(({ grounding }) => grounding === "grounded").length, claims.length),
		rate(...RATE_DEFINITIONS[3], context, required.filter(({ attribution }) => attribution === "present").length, required.length),
		rate(...RATE_DEFINITIONS[4], context, events.filter(({ assessment }) => assessment === "covered").length, events.length),
		rate(...RATE_DEFINITIONS[5], context, announcements.filter(({ assessment }) => assessment === "relevant").length, announcement ? announcements.length : 0, announcement ? undefined : "role_not_applicable"),
	];
}

interface Sample { run_id: string; trial_id: string; invocation_id: string; value: number }
function distribution(metric: typeof DISTRIBUTIONS[number], context: ScorecardContext, candidates: readonly { identity: Omit<Sample, "value">; value: number | undefined }[]) {
	const samples: Sample[] = candidates.flatMap(({ identity, value }) => value === undefined ? [] : [{ ...identity, value }]);
	const values = samples.map(({ value }) => value).sort((left, right) => left - right); const middle = Math.floor(values.length / 2);
	const summary = values.length === 0 ? { state: "unavailable" as const } : { state: "measured" as const, min: values[0]!, median: values.length % 2 === 0 ? (values[middle - 1]! + values[middle]!) / 2 : values[middle]!, mean: values.reduce((sum, value) => sum + value, 0) / values.length, max: values.at(-1)! };
	return { metric, unit: metric.includes("tokens") ? "tokens" as const : "milliseconds" as const, scorecard_context: context, sample_count: candidates.length, observed_sample_count: samples.length, unavailable_sample_count: candidates.length - samples.length, samples, summary };
}

function distributions(input: LoadedEvaluationScorecardInput, step: ProductionModelStep, context: ScorecardContext) {
	const attempts = roleEvidence(input, step).flatMap(({ loaded, trial, invocations }) => invocations.map((invocation) => ({ loaded, trial, invocation })));
	const completions = attempts.filter(({ invocation }) => invocation.transport === "succeeded");
	const captured = completions.map((item) => ({ ...item, runtime: item.loaded.run.runtime_evidence.find(({ invocation_id }) => invocation_id === item.invocation.id) })).filter((item): item is typeof item & { runtime: Extract<ScorecardBenchmarkRun["runtime_evidence"][number], { state: "captured" }> } => item.runtime?.state === "captured");
	const identity = ({ loaded, trial, invocation }: typeof attempts[number]) => ({ run_id: loaded.run.id, trial_id: trial.id, invocation_id: invocation.id });
	const token = (field: "input_tokens" | "output_tokens" | "total_tokens") => completions.map((item) => ({ identity: identity(item), value: item.invocation.transport === "succeeded" && item.invocation.completion.token_usage.measurement === "reported" ? item.invocation.completion.token_usage[field] : undefined }));
	const timing = (field: "time_to_first_token_ms" | "total_time_ms") => captured.map((item) => ({ identity: identity(item), value: item.runtime.evidence.prediction_observation[field].state === "observed" ? item.runtime.evidence.prediction_observation[field].value : undefined }));
	return [distribution(DISTRIBUTIONS[0], context, token("input_tokens")), distribution(DISTRIBUTIONS[1], context, token("output_tokens")), distribution(DISTRIBUTIONS[2], context, token("total_tokens")), distribution(DISTRIBUTIONS[3], context, attempts.map((item) => ({ identity: identity(item), value: item.invocation.transport === "in_flight" ? undefined : item.invocation.duration_ms }))), distribution(DISTRIBUTIONS[4], context, timing("time_to_first_token_ms")), distribution(DISTRIBUTIONS[5], context, timing("total_time_ms"))];
}

function qualitative(input: LoadedEvaluationScorecardInput, step: ProductionModelStep, context: ScorecardContext) {
	const reviews = input.reviews.reviews.filter(({ output }) => output.production_step === step);
	return CRITERIA.map((criterion, criterionIndex) => {
		const evidence = reviews.map((review) => {
			const assessment = review.criteria[criterionIndex]!;
			return { review_id: review.review_id, output: review.output, assessment: assessment.assessment, rationale: assessment.rationale, uncertainty: assessment.uncertainty };
		});
		return { criterion, unit: "review_assessment" as const, sample_unit: "codex_reviewed_output" as const, scorecard_context: context, sample_count: evidence.length, counts: { meets: evidence.filter(({ assessment }) => assessment === "meets").length, partly_meets: evidence.filter(({ assessment }) => assessment === "partly_meets").length, does_not_meet: evidence.filter(({ assessment }) => assessment === "does_not_meet").length, uncertain: evidence.filter(({ assessment }) => assessment === "uncertain").length }, evidence };
	});
}

function roleScorecard(input: LoadedEvaluationScorecardInput, step: ProductionModelStep): EvaluationRoleScorecard {
	const config = input.runs[0]?.run.declaration.configurations.find(({ identity }) => identity === input.declaration.configuration_identity)?.config;
	if (config === undefined) fail("configuration_mismatch", input.declarationPath, "Selected configuration is missing");
	const context = contextFor(input, step);
	return { production_step: step, adapter: config.production_steps[step], scorecard_context: context, sample_counts: counts(input, step), rates: rates(input, step, context), distributions: distributions(input, step, context), qualitative: qualitative(input, step, context) };
}

export function buildEvaluationScorecardV2(input: LoadedEvaluationScorecardInput, options: { readonly id: string; readonly createdAt: string }): EvaluationScorecardArtifact {
	input = validateLoadedEvaluationScorecardInput(input);
	const created = Date.parse(options.createdAt);
	if (!Number.isFinite(created) || created < Date.parse(input.annotations.annotated_at) || created < Date.parse(input.reviews.reviewed_at)) fail("chronology_mismatch", input.declarationPath, "Scorecard creation cannot predate annotation or review");
	const firstRun = input.runs[0]?.run; const config = firstRun?.declaration.configurations.find(({ identity }) => identity === input.declaration.configuration_identity)?.config;
	if (firstRun === undefined || config === undefined) fail("configuration_mismatch", input.declarationPath, "Selected configuration is missing");
	const candidate = {
		version: 2 as const, id: options.id, created_at: options.createdAt,
		source_reference: input.sourceReference,
		corpus: { id: input.corpus.manifest.id, fixture_count: input.corpus.entries.length },
		configuration: { identity: input.declaration.configuration_identity, exact_config: config }, repetition_count: firstRun.declaration.repetition_count,
		sources: {
			corpus_manifest_path: input.declaration.corpus.manifest_path,
			benchmark_runs: input.runs.map(({ declaration, run }) => ({
				ordinal: declaration.ordinal,
				corpus_fixture_id: declaration.corpus_fixture_id,
				benchmark_run_id: run.id,
				...(run.version === 8 ? {
					benchmark_run_version: 8 as const,
					gateway_request_sha256s: run.gateway_requests.map((record) => sha256Json(canonical(record))),
				} : {}),
				path: declaration.path,
				code_commit_sha: run.provenance.code.commit_sha,
				prepared_evidence_identity_sha256: run.prepared_evidence.identity_sha256,
				output_contract_sha256s: run.provenance.output_contracts.map(({ schema_sha256 }) => schema_sha256),
				transport_retry_limit: run.declaration.transport_retry_limit,
			})),
			annotations: { path: input.declaration.annotations.path, bundle_id: input.annotations.id, protocol_id: input.annotations.protocol.id, annotator_id: input.annotations.annotator.id, annotator_kind: input.annotations.annotator.kind, annotated_at: input.annotations.annotated_at },
			qualitative_reviews: { path: input.declaration.qualitative_reviews.path, bundle_id: input.reviews.id, rubric_id: input.reviews.rubric.id, reviewer_id: input.reviews.reviewer.id, reviewer_kind: input.reviews.reviewer.kind, reviewed_at: input.reviews.reviewed_at },
		},
		scorecards: PRODUCTION_MODEL_STEPS.map((step) => roleScorecard(input, step)),
	};
	const result = EvaluationScorecardArtifactSchema.safeParse(candidate);
	if (!result.success) fail("artifact_tampered", input.declarationPath, `Built scorecard violated its contract: ${result.error.message}`);
	return result.data;
}
