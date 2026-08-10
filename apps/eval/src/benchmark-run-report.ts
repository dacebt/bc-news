import type { BenchmarkRun } from "./evaluation-artifact";

export function formatBenchmarkRunReport(benchmark: BenchmarkRun, path: string): string {
	const diagnosticCount = benchmark.trials.reduce(
		(count, trial) => count + Object.values(trial.tracks).reduce((trackCount, track) => trackCount + track.findings.length, 0),
		0,
	);
	const diagnostics = benchmark.trials.flatMap((trial, trialIndex) => Object.entries(trial.tracks).flatMap(
		([track, state]) => state.findings.map((finding) => `Diagnostic trial=${String(trialIndex + 1)} track=${track} kind=${finding.kind} code=${finding.code}: ${finding.message}`),
	));
	const runtimeEvidence = benchmark.version === 7
		? benchmark.runtime_evidence.reduce((counts, record) => ({ ...counts, [record.state]: counts[record.state] + 1 }), { pending: 0, captured: 0, unavailable: 0 })
		: undefined;
	return [
		`Benchmark Run: ${benchmark.id}`,
		`Evaluation Trials: ${String(benchmark.trials.length)}`,
		`Subject outcomes: ${Object.entries(benchmark.outcome_counts).map(([outcome, count]) => `${outcome}=${String(count)}`).join(", ")}`,
		`Retained diagnostics: ${String(diagnosticCount)}`,
		...(runtimeEvidence === undefined ? [] : [`Runtime evidence: pending=${String(runtimeEvidence.pending)}, captured=${String(runtimeEvidence.captured)}, unavailable=${String(runtimeEvidence.unavailable)}`]),
		...diagnostics,
		`Harness outcome: ${benchmark.harness_outcome}`,
		`Retained artifact: ${path}`,
	].join("\n");
}
