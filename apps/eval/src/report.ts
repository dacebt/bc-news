import type { RecordedModelSampling } from "@bc-news/fixtures";
import { PRODUCTION_MODEL_STEPS, type EditorialDiagnostic } from "@bc-news/generation-core";
import type { RunComparison } from "./compare";
import type { RecordCommandResult } from "./record-command";
import type { RunFile, RunFileRead } from "./run-file";

function formatRecordedSampling(sampling: RecordedModelSampling): string {
	if (sampling.adapter === "openai_compatible_hosted") {
		return "openai_compatible_hosted/not_applicable";
	}
	if (sampling.posture === "provider_default") return "lmstudio/provider_default";
	return `lmstudio/explicit(temperature=${String(sampling.config.temperature)}, top_p=${String(sampling.config.top_p)}, top_k=${String(sampling.config.top_k)})`;
}

function formatDiagnostics(
	label: string,
	diagnostics: readonly EditorialDiagnostic[] | undefined,
): string[] {
	if (diagnostics === undefined) return [`${label}: unknown (not retained)`];
	if (diagnostics.length === 0) return [`${label}: observed none`];
	return [
		`${label}: ${String(diagnostics.length)} observed`,
		...diagnostics.map((diagnostic) =>
			`- ${diagnostic.production_step} ${diagnostic.kind}/${diagnostic.code}: ${diagnostic.message}`
		),
	];
}

export function formatRunSummary(run: RunFile, outputPath: string): string {
	const roster = run.steps.map((step) => step.production_step).join(" -> ");
	return [
		`Saved: ${outputPath}`,
		`Production steps: ${roster}`,
		...formatDiagnostics("Diagnostics", run.diagnostics),
	].join("\n");
}

export function formatRunListing(runs: readonly RunFileRead[]): string {
	if (runs.length === 0) return "No saved runs.";
	return runs.map((run) => {
		const roster = run.steps.map((step) => step.production_step ?? "legacy").join(", ") || "none";
		const diagnostics = run.diagnostics === undefined
			? "unknown"
			: `${String(run.diagnostics.length)} observed`;
		return `${run.id}  started ${run.started_at ?? "unknown"}  steps: ${roster}  diagnostics: ${diagnostics}`;
	}).join("\n");
}

export function formatRunDetail(run: RunFileRead): string {
	return JSON.stringify(run, null, 2);
}

export function formatRunComparison(comparison: RunComparison): string {
	const lines = [`Compare ${comparison.leftId} -> ${comparison.rightId}`];
	if (comparison.differences.length === 0) {
		lines.push(
			comparison.leftDiagnostics !== undefined && comparison.rightDiagnostics !== undefined
				? "Retained products and observed diagnostics: no differences"
				: "Retained products: no differences",
		);
	} else lines.push(...comparison.differences.map((path) => `- ${path}`));
	lines.push(...formatDiagnostics("Left diagnostics", comparison.leftDiagnostics));
	lines.push(...formatDiagnostics("Right diagnostics", comparison.rightDiagnostics));
	return lines.join("\n");
}

export function formatRecordSummary(result: RecordCommandResult): string {
	const lines = [`Recorded responses: ${result.responseDirectory}`];
	lines.push("Artifact version: 2");
	lines.push("Sampling evidence:");
	for (const productionStep of PRODUCTION_MODEL_STEPS) {
		lines.push(`- ${productionStep}: ${formatRecordedSampling(result.recordedResponses[productionStep].sampling)}`);
	}
	lines.push(...formatDiagnostics("Live diagnostics", result.liveDiagnostics));
	lines.push(...formatDiagnostics("Replay diagnostics", result.replayDiagnostics));
	if (result.comparison.differences.length === 0) {
		lines.push("Final editorial products: no differences");
	} else {
		lines.push("Final editorial products: differences");
		lines.push(...result.comparison.differences.map((path) => `- ${path}`));
	}
	return lines.join("\n");
}
