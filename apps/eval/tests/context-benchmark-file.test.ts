import { expect, test } from "vitest";
import { PRODUCTION_MODEL_STEPS } from "@bc-news/generation-core";
import {
	CONTEXT_BENCHMARK_LOADS,
	ContextBenchmarkFileSchema,
	type ContextBenchmarkFile,
} from "../src/context-benchmark-file";

const HASH = "a".repeat(64);

function validReport(): ContextBenchmarkFile {
	return ContextBenchmarkFileSchema.parse({
		id: "context-test",
		fixture: {
			path: "packages/fixtures/evidence/active-region-7_2026-01-24.json",
			fixture_sha256: HASH,
			prepared_message_ceiling: 208,
		},
		loads: CONTEXT_BENCHMARK_LOADS,
		model: {
			identifier: "qwen3-local",
			model_key: "qwen3-local-key",
			path: "lmstudio-community/qwen3-local",
			display_name: "Qwen 3 Local",
			context_length: 1_000,
			measurement_runtime: "lmstudio_sdk_1.5",
		},
		rows: CONTEXT_BENCHMARK_LOADS.flatMap((messageLoad) =>
			PRODUCTION_MODEL_STEPS.map((productionStep) => ({
				message_load: messageLoad,
				production_step: productionStep,
				prompt_sha256: HASH,
				request_sha256: HASH,
				structured_output: {
					name: `${productionStep}_output`,
					schema_sha256: HASH,
					enforcement: "lmstudio_json_schema",
				},
				fixed_input_tokens: 10,
				evidence_or_draft_tokens: 10,
				runtime_delta_tokens: 0,
				input_tokens: 20,
				completion_tokens: 10,
				total_tokens: 30,
				context_headroom_tokens: 970,
				completion_bytes: 20,
			})),
		),
		started_at: "2026-08-06T12:00:00.000Z",
		completed_at: "2026-08-06T12:01:00.000Z",
	});
}

test("rejects rows outside the exact load and production-step order", () => {
	const report = validReport();
	const rows = [...report.rows];
	[rows[0], rows[1]] = [rows[1]!, rows[0]!];

	const parsed = ContextBenchmarkFileSchema.safeParse({ ...report, rows });

	expect(parsed.success).toBe(false);
	if (!parsed.success) {
		expect(parsed.error.issues).toEqual(expect.arrayContaining([
			expect.objectContaining({ path: ["rows"], message: "rows must match the exact load and production-step order" }),
		]));
	}
});

test("rejects token component arithmetic that does not equal reported input usage", () => {
	const report = validReport();
	const rows = report.rows.map((row, index) => index === 0 ? { ...row, runtime_delta_tokens: 1 } : row);

	const parsed = ContextBenchmarkFileSchema.safeParse({ ...report, rows });

	expect(parsed.success).toBe(false);
	if (!parsed.success) {
		expect(parsed.error.issues).toEqual(expect.arrayContaining([
			expect.objectContaining({ path: ["rows", 0, "input_tokens"], message: "input components must sum exactly" }),
		]));
	}
});

test("rejects total and context-headroom arithmetic drift", () => {
	const report = validReport();
	const rows = report.rows.map((row, index) => index === 0 ? { ...row, context_headroom_tokens: 969 } : row);

	const parsed = ContextBenchmarkFileSchema.safeParse({ ...report, rows });

	expect(parsed.success).toBe(false);
	if (!parsed.success) {
		expect(parsed.error.issues).toEqual(expect.arrayContaining([
			expect.objectContaining({
				path: ["rows", 0, "context_headroom_tokens"],
				message: "total plus headroom must equal the loaded context length",
			}),
		]));
	}
});
