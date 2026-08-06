import type { RunComparison } from "./compare";
import type { RunFile, RunFileRead } from "./run-file";

export function formatRunSummary(run: RunFile, outputPath: string): string {
	const roster = run.steps.map((step) => step.production_step).join(" -> ");
	return `Saved: ${outputPath}\nProduction steps: ${roster}`;
}

export function formatRunListing(runs: readonly RunFileRead[]): string {
	if (runs.length === 0) return "No saved runs.";
	return runs.map((run) => {
		const roster = run.steps.map((step) => step.production_step ?? "legacy").join(", ") || "none";
		return `${run.id}  started ${run.started_at ?? "unknown"}  steps: ${roster}`;
	}).join("\n");
}

export function formatRunDetail(run: RunFileRead): string {
	return JSON.stringify(run, null, 2);
}

export function formatRunComparison(comparison: RunComparison): string {
	const lines = [`Compare ${comparison.leftId} -> ${comparison.rightId}`];
	if (comparison.differences.length === 0) lines.push("No differences beyond run identity and time.");
	else lines.push(...comparison.differences.map((path) => `- ${path}`));
	return lines.join("\n");
}
