import type { BenchmarkRun } from "./evaluation-artifact";

export function formatBenchmarkRunReport(benchmark: BenchmarkRun, path: string): string {
	return [
		`Benchmark Run: ${benchmark.id}`,
		`Evaluation Trials: ${String(benchmark.trials.length)}`,
		`Subject outcomes: ${Object.entries(benchmark.outcome_counts).map(([outcome, count]) => `${outcome}=${String(count)}`).join(", ")}`,
		`Harness outcome: ${benchmark.harness_outcome}`,
		`Retained artifact: ${path}`,
	].join("\n");
}
