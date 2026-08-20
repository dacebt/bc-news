import type { BenchmarkRun } from "./evaluation-artifact";

export interface BenchmarkContextProjection {
	readonly version: BenchmarkRun["version"];
	readonly fixture: BenchmarkRun["fixture"];
	readonly prepared_evidence: BenchmarkRun["prepared_evidence"];
	readonly declaration: BenchmarkRun["declaration"];
	readonly provenance: BenchmarkRun["provenance"];
	readonly runtime_execution_contexts: readonly unknown[];
	readonly gateway_request_contexts: readonly unknown[];
}

function invocationOrdinalById(run: BenchmarkRun, trialIndex: number): ReadonlyMap<string, number> {
	return new Map(run.trials[trialIndex]?.invocations.map(({ id }, index) => [id, index + 1]));
}

type RuntimeEvidenceRun = Extract<BenchmarkRun, { version: 7 }> | Extract<BenchmarkRun, { version: 8 }> | Extract<BenchmarkRun, { version: 9 }>;

function runtimeEvidenceOrdinal(run: RuntimeEvidenceRun, record: RuntimeEvidenceRun["runtime_evidence"][number]) {
	return {
		trial_roster_ordinal: run.trial_roster.findIndex(({ trial_id }) => trial_id === record.trial_id) + 1,
		configuration_ordinal: run.declaration.configurations.findIndex(({ identity }) => identity === record.config_identity) + 1,
		configuration_identity: record.config_identity,
		production_step: record.production_step,
		invocation_ordinal: record.ordinal,
	};
}

export function projectBenchmarkContext(run: BenchmarkRun): BenchmarkContextProjection {
	return {
		version: run.version,
		fixture: run.fixture,
		prepared_evidence: run.prepared_evidence,
		declaration: run.declaration,
		provenance: run.provenance,
		runtime_execution_contexts: "runtime_evidence" in run
			? run.runtime_evidence.map((record) => ({
				...runtimeEvidenceOrdinal(run, record),
				execution_context: record.state === "captured" ? record.evidence.execution_context : null,
			}))
			: [],
		gateway_request_contexts: "gateway_requests" in run
			? run.gateway_requests.map((record) => ({
				trial_roster_ordinal: run.trial_roster.findIndex(({ trial_id }) => trial_id === record.trial_id) + 1,
				configuration_ordinal: run.declaration.configurations.findIndex(({ identity }) => identity === record.config_identity) + 1,
				production_step: record.production_step,
				invocation_ordinal: record.ordinal,
				...(record.state === "captured" ? {
					account_id: record.provenance.account_id,
					gateway: record.provenance.gateway,
					requested_model: record.provenance.requested_model,
					policy: record.provenance.policy,
				} : {}),
			}))
			: [],
	};
}

export function projectBenchmarkBehavior(run: BenchmarkRun) {
	return {
		lifecycle: run.lifecycle,
		harness_outcome: run.harness_outcome,
		outcome_counts: run.outcome_counts,
		runtime_prediction_observations: "runtime_evidence" in run
			? run.runtime_evidence.map((record) => ({
				...runtimeEvidenceOrdinal(run, record),
				state: record.state,
				...(record.state === "unavailable" ? { reason: record.reason } : {}),
				...(record.state === "captured" ? { prediction_observation: record.evidence.prediction_observation } : {}),
			}))
			: [],
		gateway_request_observations: "gateway_requests" in run
			? run.gateway_requests.map((record) => ({
				invocation_id: record.invocation_id,
				state: record.state,
				...(record.state === "unavailable" ? { reason: record.reason } : {}),
				...(record.state === "captured" ? {
					gateway_log_id: record.provenance.gateway_log_id,
					correlation: record.provenance.correlation,
				} : {}),
			}))
			: [],
		trials: run.trials.map((trial, trialIndex) => {
			const invocationOrdinals = invocationOrdinalById(run, trialIndex);
			const selectedByOrdinal = Object.fromEntries(Object.entries(trial.selected_invocation_ids).map(
				([step, id]) => [step, id === null ? null : invocationOrdinals.get(id) ?? null],
			));
			return {
				roster_ordinal: trialIndex + 1,
				configuration_ordinal: run.declaration.configurations.findIndex(
					({ identity }) => identity === trial.config_identity,
				) + 1,
				repetition: trial.repetition,
				lifecycle: trial.lifecycle,
				subject_outcome: trial.subject_outcome,
				tracks: trial.tracks,
				selected_invocation_ordinals: selectedByOrdinal,
				invocations: trial.invocations.map((invocation) => ({
					ordinal: invocation.ordinal,
					production_step: invocation.production_step,
					predecessor_ordinal: invocation.predecessor_invocation_id === null
						? null
						: invocationOrdinals.get(invocation.predecessor_invocation_id) ?? null,
					request: invocation.request,
					request_sha256: invocation.request_sha256,
					transport: invocation.transport,
					...(invocation.transport === "succeeded" ? {
						completion: invocation.completion,
						duration_ms: invocation.duration_ms,
						parse: invocation.parse,
					} : {}),
					...(invocation.transport === "failed" ? {
						failure: invocation.failure,
						duration_ms: invocation.duration_ms,
						retry_classification: invocation.retry_classification,
						parse: invocation.parse,
					} : {}),
					...(invocation.transport === "in_flight" ? { parse: invocation.parse } : {}),
				})),
			};
		}),
	};
}

export type BenchmarkBehaviorProjection = ReturnType<typeof projectBenchmarkBehavior>;
