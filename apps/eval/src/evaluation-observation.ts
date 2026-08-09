import type { BenchmarkRun } from "./evaluation-artifact";
import { lmStudioSamplingPosture, type LmStudioSamplingPosture } from "./config";

export interface BenchmarkContextProjection {
	readonly version: BenchmarkRun["version"];
	readonly fixture: BenchmarkRun["fixture"];
	readonly prepared_evidence: BenchmarkRun["prepared_evidence"];
	readonly declaration: BenchmarkRun["declaration"];
	readonly lm_studio_sampling_postures: readonly LmStudioSamplingPosture[];
	readonly provenance: BenchmarkRun["provenance"];
}

function invocationOrdinalById(run: BenchmarkRun, trialIndex: number): ReadonlyMap<string, number> {
	return new Map(run.trials[trialIndex]?.invocations.map(({ id }, index) => [id, index + 1]));
}

export function projectBenchmarkContext(run: BenchmarkRun): BenchmarkContextProjection {
	return {
		version: run.version,
		fixture: run.fixture,
		prepared_evidence: run.prepared_evidence,
		declaration: run.declaration,
		lm_studio_sampling_postures: run.declaration.configurations.map(({ config }) => lmStudioSamplingPosture(config)),
		provenance: run.provenance,
	};
}

export function projectBenchmarkBehavior(run: BenchmarkRun) {
	return {
		lifecycle: run.lifecycle,
		harness_outcome: run.harness_outcome,
		outcome_counts: run.outcome_counts,
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
