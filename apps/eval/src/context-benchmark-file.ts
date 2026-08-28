import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
	CURRENT_PRODUCTION_MODEL_STEPS,
	CurrentProductionModelStepSchema,
	type CurrentProductionModelStep,
} from "./current-production-steps";
import { RunIdSchema, Sha256HashSchema, generateRunId } from "./run-file";

export const LEGACY_CONTEXT_BENCHMARK_LOADS = [1, 50, 100, 150, 208] as const;
export const CONTEXT_BENCHMARK_LOADS = [1, 50, 100, 150, 553] as const;

const ContextBenchmarkRowSchema = z.strictObject({
	message_load: z.int().positive(),
	production_step: CurrentProductionModelStepSchema,
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

const ContextBenchmarkSamplingEvidenceSchema = z.discriminatedUnion("posture", [
	z.strictObject({
		adapter: z.literal("lmstudio"),
		posture: z.literal("provider_default"),
	}),
	z.strictObject({
		adapter: z.literal("lmstudio"),
		posture: z.literal("explicit"),
		config: z.strictObject({
			temperature: z.number().finite().min(0).max(2),
			top_p: z.number().finite().min(0).max(1),
			top_k: z.int().nonnegative(),
		}),
	}),
]);

const ContextBenchmarkSamplingByStepSchema = z.strictObject({
	main_story_write: ContextBenchmarkSamplingEvidenceSchema,
	announcements_write: ContextBenchmarkSamplingEvidenceSchema,
});

const HistoricalContextBenchmarkFileShape = {
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
		LEGACY_CONTEXT_BENCHMARK_LOADS.length * CURRENT_PRODUCTION_MODEL_STEPS.length,
	),
	started_at: z.iso.datetime({ offset: true }),
	completed_at: z.iso.datetime({ offset: true }),
} as const;

const CurrentContextBenchmarkFileShape = {
	id: RunIdSchema,
	fixture: z.strictObject({
		path: z.string().min(1),
		fixture_sha256: Sha256HashSchema,
		prepared_message_ceiling: z.literal(553),
	}),
	loads: z.tuple([
		z.literal(1),
		z.literal(50),
		z.literal(100),
		z.literal(150),
		z.literal(553),
	]),
	model: HistoricalContextBenchmarkFileShape.model,
	rows: z.array(ContextBenchmarkRowSchema).length(
		CONTEXT_BENCHMARK_LOADS.length * CURRENT_PRODUCTION_MODEL_STEPS.length,
	),
	started_at: HistoricalContextBenchmarkFileShape.started_at,
	completed_at: HistoricalContextBenchmarkFileShape.completed_at,
} as const;

function validateContextBenchmarkRows(
	report: { readonly rows: readonly ContextBenchmarkRow[]; readonly model: { readonly context_length: number } },
	context: z.core.$RefinementCtx,
	loads: readonly number[],
): void {
	const expected = loads.flatMap((messageLoad) =>
		CURRENT_PRODUCTION_MODEL_STEPS.map(
			(productionStep) => `${messageLoad}:${productionStep}`,
		)
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
}

function validateContextBenchmarkSamplingPosture(
	report: { readonly sampling: z.infer<typeof ContextBenchmarkSamplingByStepSchema> },
	context: z.core.$RefinementCtx,
): void {
	const postures = new Set(Object.values(report.sampling).map(({ posture }) => posture));
	if (postures.size > 1) {
		context.addIssue({
			code: "custom",
			path: ["sampling"],
			message: "all LM Studio production steps must retain one sampling posture",
		});
	}
}

export const LegacyContextBenchmarkFileSchema = z.strictObject(
	HistoricalContextBenchmarkFileShape,
).superRefine((report, context) => {
	validateContextBenchmarkRows(report, context, LEGACY_CONTEXT_BENCHMARK_LOADS);
});

export const ContextBenchmarkFileV2Schema = z.strictObject({
	version: z.literal(2),
	...HistoricalContextBenchmarkFileShape,
	sampling: ContextBenchmarkSamplingByStepSchema,
}).superRefine((report, context) => {
	validateContextBenchmarkRows(report, context, LEGACY_CONTEXT_BENCHMARK_LOADS);
	validateContextBenchmarkSamplingPosture(report, context);
});

const ContextBenchmarkAgentConfigurationSchema = z.strictObject({
	adapter: z.literal("lmstudio"),
	model: z.string().trim().min(1),
	temperature: z.number().finite().min(0).max(2).optional(),
	top_p: z.number().finite().min(0).max(1).optional(),
	top_k: z.number().int().min(1).max(500).optional(),
	enable_thinking: z.boolean().optional(),
	reasoning_effort: z.literal("provider_default"),
});

const ContextBenchmarkConfigurationsByStepSchema = z.strictObject({
	main_story_write: ContextBenchmarkAgentConfigurationSchema,
	announcements_write: ContextBenchmarkAgentConfigurationSchema,
});

function validateContextBenchmarkAgentModels(
	report: {
		readonly agent_configurations: z.infer<typeof ContextBenchmarkConfigurationsByStepSchema>;
		readonly model: {
			readonly identifier: string;
			readonly model_key: string;
			readonly path: string;
			readonly display_name: string;
		};
	},
	context: z.core.$RefinementCtx,
): void {
	const configuredModels = CURRENT_PRODUCTION_MODEL_STEPS.map(
		(step) => report.agent_configurations[step].model,
	);
	if (new Set(configuredModels).size !== 1) {
		context.addIssue({
			code: "custom",
			path: ["agent_configurations"],
			message: "all context benchmark agents must retain one configured model",
		});
	}

	const loadedModelNames = new Set([
		report.model.identifier,
		report.model.model_key,
		report.model.path,
		report.model.display_name,
	]);
	for (const step of CURRENT_PRODUCTION_MODEL_STEPS) {
		if (!loadedModelNames.has(report.agent_configurations[step].model)) {
			context.addIssue({
				code: "custom",
				path: ["agent_configurations", step, "model"],
				message: "configured model must identify the retained loaded model",
			});
		}
	}
}

export const ContextBenchmarkFileV3Schema = z.strictObject({
	version: z.literal(3),
	...HistoricalContextBenchmarkFileShape,
	agent_configurations: ContextBenchmarkConfigurationsByStepSchema,
}).superRefine((report, context) => {
	validateContextBenchmarkRows(report, context, LEGACY_CONTEXT_BENCHMARK_LOADS);
	validateContextBenchmarkAgentModels(report, context);
});

export const ContextBenchmarkFileV4Schema = z.strictObject({
	version: z.literal(4),
	...CurrentContextBenchmarkFileShape,
	agent_configurations: ContextBenchmarkConfigurationsByStepSchema,
}).superRefine((report, context) => {
	validateContextBenchmarkRows(report, context, CONTEXT_BENCHMARK_LOADS);
	validateContextBenchmarkAgentModels(report, context);
});

export const ContextBenchmarkFileSchema = z.union([
	ContextBenchmarkFileV4Schema,
	ContextBenchmarkFileV3Schema,
	ContextBenchmarkFileV2Schema,
	LegacyContextBenchmarkFileSchema,
]);

export type ContextBenchmarkFile = z.infer<typeof ContextBenchmarkFileSchema>;
export type ContextBenchmarkFileV2 = z.infer<typeof ContextBenchmarkFileV2Schema>;
export type ContextBenchmarkFileV3 = z.infer<typeof ContextBenchmarkFileV3Schema>;
export type ContextBenchmarkFileV4 = z.infer<typeof ContextBenchmarkFileV4Schema>;
export type ContextBenchmarkRow = z.infer<typeof ContextBenchmarkRowSchema>;
export type ContextBenchmarkStep = CurrentProductionModelStep;

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
