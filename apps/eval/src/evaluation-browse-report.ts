import type { BenchmarkRun } from "./evaluation-artifact";
import type { BenchmarkComparison } from "./evaluation-comparison";
import { lmStudioSamplingPosture } from "./config";

type Trial = BenchmarkRun["trials"][number];
type Invocation = Trial["invocations"][number];
type TrackFindings = Trial["tracks"]["main_story"]["findings"];

function increment(counts: Record<string, number>, key: string): void {
	counts[key] = (counts[key] ?? 0) + 1;
}

function diagnosticProjection(version: BenchmarkRun["version"], findings: TrackFindings) {
	return version === 5 ? {
		diagnostic_count: findings.length,
		diagnostics: findings,
	} : {};
}

function trackProducts(trial: Trial, trialOrdinal: number, version: BenchmarkRun["version"]) {
	return Object.entries(trial.tracks).flatMap(([track, state]) => state.product === null ? [] : [{
		trial_ordinal: trialOrdinal,
		track,
		track_outcome: state.subject_outcome,
		product: state.product,
		...diagnosticProjection(version, state.findings),
	}]);
}

function invocationEvidence(invocation: Invocation, trialOrdinal: number) {
	const base = {
		trial_ordinal: trialOrdinal,
		ordinal: invocation.ordinal,
		production_step: invocation.production_step,
		transport: invocation.transport,
		duration_ms: invocation.transport === "in_flight" ? null : invocation.duration_ms,
		retry: invocation.predecessor_invocation_id !== null,
	};
	if (invocation.transport !== "succeeded") return base;
	return {
		...base,
		completion: invocation.completion,
	};
}

export function summarizeBenchmarkRun(run: BenchmarkRun) {
	const trackOutcomes: Record<string, number> = {};
	const findingKinds: Record<string, number> = {};
	const diagnosticKinds: Record<string, number> = {};
	for (const trial of run.trials) {
		for (const track of Object.values(trial.tracks)) {
			increment(trackOutcomes, track.subject_outcome ?? "pending");
			for (const finding of track.findings) {
				increment(findingKinds, finding.kind);
				if (run.version === 5) increment(diagnosticKinds, finding.kind);
			}
		}
		for (const invocation of trial.invocations) {
			if (invocation.transport === "succeeded" && invocation.parse.state === "rejected") {
				for (const finding of invocation.parse.findings) increment(findingKinds, finding.kind);
			}
		}
	}
	return {
		id: run.id,
		version: run.version,
		lifecycle: run.lifecycle,
		harness_outcome: run.harness_outcome,
		fixture: run.fixture,
		prepared_evidence: run.prepared_evidence,
		provenance: run.provenance,
		configurations: run.declaration.configurations.map(({ identity, config }, index) => ({
			ordinal: index + 1,
			identity,
			lm_studio_sampling_posture: lmStudioSamplingPosture(config),
			production_steps: config.production_steps,
		})),
		policy: {
			repetition_count: run.declaration.repetition_count,
			transport_retry_limit: run.version === 1 ? 0 : run.declaration.transport_retry_limit,
		},
		trials: run.trials.map((trial, index) => {
			const configurationOrdinal = run.declaration.configurations.findIndex(
				({ identity }) => identity === trial.config_identity,
			) + 1;
			return {
				ordinal: index + 1,
				configuration_ordinal: configurationOrdinal,
				configuration_identity: trial.config_identity,
				repetition: trial.repetition,
				lifecycle: trial.lifecycle,
				subject_outcome: trial.subject_outcome,
				tracks: {
					main_story: {
						lifecycle: trial.tracks.main_story.lifecycle,
						subject_outcome: trial.tracks.main_story.subject_outcome,
						terminal_production_step: trial.tracks.main_story.terminal_production_step,
						...diagnosticProjection(run.version, trial.tracks.main_story.findings),
					},
					announcements: {
						lifecycle: trial.tracks.announcements.lifecycle,
						subject_outcome: trial.tracks.announcements.subject_outcome,
						terminal_production_step: trial.tracks.announcements.terminal_production_step,
						...diagnosticProjection(run.version, trial.tracks.announcements.findings),
					},
				},
			};
		}),
		outcome_counts: run.outcome_counts,
		track_outcome_counts: trackOutcomes,
		finding_kind_counts: findingKinds,
		diagnostic_kind_counts: diagnosticKinds,
		products: run.trials.flatMap((trial, index) => trackProducts(trial, index + 1, run.version)),
		invocation_count: run.trials.reduce((count, trial) => count + trial.invocations.length, 0),
		retry_count: run.trials.reduce(
			(count, trial) => count + trial.invocations.filter(({ predecessor_invocation_id }) => predecessor_invocation_id !== null).length,
			0,
		),
		invocations: run.trials.flatMap((trial, index) => trial.invocations.map(
			(invocation) => invocationEvidence(invocation, index + 1),
		)),
	};
}

export function formatBenchmarkListing(runs: readonly BenchmarkRun[]): string {
	if (runs.length === 0) return "No Benchmark Runs found.";
	return JSON.stringify(runs.map((run) => ({
		id: run.id,
		version: run.version,
		lifecycle: run.lifecycle,
		harness_outcome: run.harness_outcome,
		started_at: run.started_at,
		trial_count: run.trials.length,
		outcome_counts: run.outcome_counts,
	})), null, 2);
}

export function formatBenchmarkDetail(run: BenchmarkRun): string {
	return JSON.stringify(run, null, 2);
}

export function formatBenchmarkSummary(run: BenchmarkRun): string {
	return JSON.stringify(summarizeBenchmarkRun(run), null, 2);
}

export function formatBenchmarkComparison(comparison: BenchmarkComparison): string {
	const behavioral = comparison.behavioralDifferences.length === 0
		? "Behavioral differences: none"
		: `Behavioral differences:\n${comparison.behavioralDifferences.map((path) => `- ${path}`).join("\n")}`;
	return [
		`Left Benchmark Run: ${comparison.leftId}`,
		`Right Benchmark Run: ${comparison.rightId}`,
		`Left context:\n${JSON.stringify(comparison.leftContext, null, 2)}`,
		`Right context:\n${JSON.stringify(comparison.rightContext, null, 2)}`,
		comparison.contextDifferences.length === 0
			? "Context differences: none"
			: `Context differences:\n${comparison.contextDifferences.map((path) => `- ${path}`).join("\n")}`,
		behavioral,
	].join("\n");
}
