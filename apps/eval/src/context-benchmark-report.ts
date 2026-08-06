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
		"",
		" load  production step          fixed  data/draft  runtime  input  output  total  headroom",
	];
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
