import type { BenchmarkRun } from "./evaluation-artifact";

export function formatEvaluationTrialReport(benchmark: BenchmarkRun, path: string): string {
	const trial = benchmark.trials[0]!;
	return [
		`Benchmark Run: ${benchmark.id}`,
		`Evaluation Trial: ${trial.id}`,
		`Subject outcome: ${trial.subject_outcome ?? "in progress"}`,
		`Harness outcome: ${benchmark.harness_outcome}`,
		`Retained artifact: ${path}`,
	].join("\n");
}
