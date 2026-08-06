import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PRODUCTION_MODEL_STEPS, ProductionModelStepSchema } from "@bc-news/generation-core";
import { z } from "zod";
import { RunIdSchema, Sha256HashSchema, generateRunId } from "./run-file";

export const CONTEXT_BENCHMARK_LOADS = [1, 50, 100, 150, 208] as const;

const ContextBenchmarkRowSchema = z.strictObject({
	message_load: z.int().positive(),
	production_step: ProductionModelStepSchema,
	prompt_sha256: Sha256HashSchema,
	request_sha256: Sha256HashSchema,
	structured_output: z.strictObject({
		name: z.string().min(1),
		schema_sha256: Sha256HashSchema,
		enforcement: z.literal("lmstudio_json_schema"),
	}),
	fixed_input_tokens: z.int().nonnegative(),
	evidence_or_draft_tokens: z.int().nonnegative(),
	runtime_delta_tokens: z.int().nonnegative(),
	input_tokens: z.int().nonnegative(),
	completion_tokens: z.int().nonnegative(),
	total_tokens: z.int().nonnegative(),
	context_headroom_tokens: z.int().nonnegative(),
	completion_bytes: z.int().nonnegative(),
}).superRefine((row, context) => {
	if (
		row.fixed_input_tokens + row.evidence_or_draft_tokens + row.runtime_delta_tokens
		!== row.input_tokens
	) {
		context.addIssue({ code: "custom", path: ["input_tokens"], message: "input components must sum exactly" });
	}
	if (row.input_tokens + row.completion_tokens !== row.total_tokens) {
		context.addIssue({ code: "custom", path: ["total_tokens"], message: "input plus completion must equal total" });
	}
});

export const ContextBenchmarkFileSchema = z.strictObject({
	id: RunIdSchema,
	fixture: z.strictObject({
		path: z.string().min(1),
		fixture_sha256: Sha256HashSchema,
		prepared_message_ceiling: z.literal(208),
	}),
	loads: z.tuple([
		z.literal(1),
		z.literal(50),
		z.literal(100),
		z.literal(150),
		z.literal(208),
	]),
	model: z.strictObject({
		identifier: z.string().min(1),
		model_key: z.string().min(1),
		path: z.string().min(1),
		display_name: z.string().min(1),
		context_length: z.int().positive(),
		measurement_runtime: z.literal("lmstudio_sdk_1.5"),
	}),
	rows: z.array(ContextBenchmarkRowSchema).length(
		CONTEXT_BENCHMARK_LOADS.length * PRODUCTION_MODEL_STEPS.length,
	),
	started_at: z.iso.datetime({ offset: true }),
	completed_at: z.iso.datetime({ offset: true }),
}).superRefine((report, context) => {
	const expected = CONTEXT_BENCHMARK_LOADS.flatMap((messageLoad) =>
		PRODUCTION_MODEL_STEPS.map((productionStep) => `${messageLoad}:${productionStep}`)
	);
	const observed = report.rows.map((row) => `${row.message_load}:${row.production_step}`);
	if (observed.some((value, index) => value !== expected[index])) {
		context.addIssue({ code: "custom", path: ["rows"], message: "rows must match the exact load and production-step order" });
	}
	for (const [index, row] of report.rows.entries()) {
		if (row.total_tokens + row.context_headroom_tokens !== report.model.context_length) {
			context.addIssue({
				code: "custom",
				path: ["rows", index, "context_headroom_tokens"],
				message: "total plus headroom must equal the loaded context length",
			});
		}
	}
});

export type ContextBenchmarkFile = z.infer<typeof ContextBenchmarkFileSchema>;
export type ContextBenchmarkRow = z.infer<typeof ContextBenchmarkRowSchema>;

export class ContextBenchmarkFileError extends Error {
	readonly code = "context_benchmark_file_rejected";

	constructor(message: string) {
		super(message);
		this.name = "ContextBenchmarkFileError";
	}
}

export function generateContextBenchmarkId(): string {
	return `context-${generateRunId()}`;
}

export async function saveContextBenchmarkFile(
	report: ContextBenchmarkFile,
	resultsDirectory: string,
): Promise<string> {
	const parsed = ContextBenchmarkFileSchema.safeParse(report);
	if (!parsed.success) throw new ContextBenchmarkFileError(parsed.error.message);
	await mkdir(resultsDirectory, { recursive: true });
	const outputPath = join(resultsDirectory, `${parsed.data.id}.json`);
	try {
		await writeFile(outputPath, `${JSON.stringify(parsed.data, null, 2)}\n`, {
			encoding: "utf8",
			flag: "wx",
		});
	} catch (cause) {
		throw new ContextBenchmarkFileError(
			cause instanceof Error ? `Could not save context benchmark: ${cause.message}` : "Could not save context benchmark",
		);
	}
	return outputPath;
}
