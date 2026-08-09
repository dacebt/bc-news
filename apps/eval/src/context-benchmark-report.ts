import { PRODUCTION_MODEL_STEPS } from "@bc-news/generation-core";
import type { ContextBenchmarkFile } from "./context-benchmark-file";

function pad(value: string | number, width: number): string {
	return String(value).padStart(width);
}

export function formatContextBenchmarkReport(report: ContextBenchmarkFile, outputPath: string): string {
	const lines = [
		`Saved: ${outputPath}`,
		`Model: ${report.model.display_name} (${report.model.identifier})`,
		`Context length: ${report.model.context_length}`,
		`Canonical prepared ceiling: ${report.fixture.prepared_message_ceiling}`,
	];
	if ("version" in report && report.version === 3) {
		lines.push("Agent configurations:");
		for (const step of PRODUCTION_MODEL_STEPS) {
			const configuration = report.agent_configurations[step];
			lines.push(`  ${step}: ${configuration.model}, temperature=${configuration.temperature === undefined ? "provider_default" : String(configuration.temperature)}`);
		}
	} else if ("version" in report) {
		lines.push("Sampling:");
		for (const step of PRODUCTION_MODEL_STEPS) {
			const sampling = report.sampling[step];
			lines.push(sampling.posture === "provider_default"
				? `  ${step}: provider_default`
				: `  ${step}: explicit (temperature=${String(sampling.config.temperature)}, top_p=${String(sampling.config.top_p)}, top_k=${String(sampling.config.top_k)})`);
		}
	} else {
		lines.push("Sampling: not retained (legacy context result)");
	}
	lines.push(
		"",
		" load  production step          fixed  data/draft  runtime  input  output  total  headroom",
	);
	for (const row of report.rows) {
		lines.push([
			pad(row.message_load, 5),
			row.production_step.padEnd(24),
			pad(row.fixed_input_tokens, 6),
			pad(row.evidence_or_draft_tokens, 10),
			pad(row.runtime_delta_tokens, 8),
			pad(row.input_tokens, 6),
			pad(row.completion_tokens, 7),
			pad(row.total_tokens, 6),
			pad(row.context_headroom_tokens, 9),
		].join("  "));
	}
	return lines.join("\n");
}
