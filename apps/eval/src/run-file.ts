import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { EditionSchema } from "@bc-news/contracts";
import {
	EditorialDiagnosticSchema,
	ModelUsageRecordSchema,
} from "@bc-news/generation-core";
import { z } from "zod";
import { EvalConfigSchema } from "./config";
import {
	CurrentProductionModelStepSchema,
	CURRENT_PRODUCTION_MODEL_STEPS,
} from "./current-production-steps";

export const Sha256HashSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const RunIdSchema = z.string().regex(
	/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/,
	"Run id must be 1-200 safe filename characters",
);

export const RunStepSchema = z.strictObject({
	production_step: CurrentProductionModelStepSchema,
	prompt_sha256: Sha256HashSchema,
	output: z.record(z.string(), z.unknown()),
	model_usage: ModelUsageRecordSchema,
}).refine((step) => step.model_usage.production_step === step.production_step, {
	message: "model usage must identify the same production step",
	path: ["model_usage", "production_step"],
});

export const RunFileSchema = z.strictObject({
	id: RunIdSchema,
	config: EvalConfigSchema,
	fixture: z.strictObject({ path: z.string().min(1), fixture_sha256: Sha256HashSchema }),
	steps: z.array(RunStepSchema).length(CURRENT_PRODUCTION_MODEL_STEPS.length),
	edition: EditionSchema,
	diagnostics: z.array(EditorialDiagnosticSchema),
	started_at: z.iso.datetime({ offset: true }),
	completed_at: z.iso.datetime({ offset: true }),
}).superRefine((run, context) => {
	const observed = run.steps.map((step) => step.production_step);
	if (observed.some((step, index) => step !== CURRENT_PRODUCTION_MODEL_STEPS[index])) {
		context.addIssue({
			code: "custom",
			path: ["steps"],
			message: "steps must match the exact ordered production roster",
		});
	}
	let previousDiagnosticStep = -1;
	for (const [index, diagnostic] of run.diagnostics.entries()) {
		const diagnosticStep = CURRENT_PRODUCTION_MODEL_STEPS.indexOf(diagnostic.production_step);
		if (diagnosticStep < previousDiagnosticStep) {
			context.addIssue({
				code: "custom",
				path: ["diagnostics", index],
				message: "diagnostics must follow production step order",
			});
		}
		previousDiagnosticStep = diagnosticStep;
	}
});
export type RunFile = z.infer<typeof RunFileSchema>;

export const RunFileReadSchema = z.looseObject({
	id: RunIdSchema,
	fixture: z.looseObject({ path: z.string(), fixture_sha256: z.string() }).optional(),
	steps: z.array(z.looseObject({
		production_step: z.string().optional(),
		prompt_sha256: z.string().optional(),
		output: z.unknown().optional(),
		model_usage: z.unknown().optional(),
	})).default([]),
	edition: z.unknown().optional(),
	diagnostics: z.array(EditorialDiagnosticSchema).optional(),
	started_at: z.string().optional(),
	completed_at: z.string().optional(),
});
export type RunFileRead = z.infer<typeof RunFileReadSchema>;

export class InvalidRunIdError extends Error {
	readonly code = "invalid_run_id";
	constructor(readonly runId: string) {
		super(`Invalid run id: ${runId}`);
		this.name = "InvalidRunIdError";
	}
}

export class SavedRunNotFoundError extends Error {
	readonly code = "saved_run_not_found";
	constructor(readonly runId: string) {
		super(`Saved run not found: ${runId}`);
		this.name = "SavedRunNotFoundError";
	}
}

export class RunFileRejectedError extends Error {
	readonly code: "write_rejected" | "read_rejected";
	constructor(
		code: "write_rejected" | "read_rejected",
		readonly source: string,
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "RunFileRejectedError";
		this.code = code;
	}
}

function hasErrorCode(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && error.code === code;
}

export function validateRunId(runId: string): string {
	const parsed = RunIdSchema.safeParse(runId);
	if (!parsed.success) throw new InvalidRunIdError(runId);
	return parsed.data;
}

export function generateRunId(): string {
	return new Date().toISOString().replace(/[:.]/g, "-");
}

export async function saveRunFile(run: RunFile, resultsDirectory: string): Promise<string> {
	const validated = RunFileSchema.safeParse(run);
	if (!validated.success) {
		throw new RunFileRejectedError("write_rejected", run.id, validated.error.message);
	}
	await mkdir(resultsDirectory, { recursive: true });
	for (let attempt = 1; attempt <= 10; attempt += 1) {
		const candidate = attempt === 1 ? validated.data : { ...validated.data, id: `${validated.data.id}-${attempt}` };
		const outputPath = join(resultsDirectory, `${candidate.id}.json`);
		try {
			await writeFile(outputPath, `${JSON.stringify(candidate, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
			return outputPath;
		} catch (error: unknown) {
			if (!hasErrorCode(error, "EEXIST")) throw error;
		}
	}
	throw new RunFileRejectedError("write_rejected", validated.data.id, "run id collided ten times");
}

function parseRunFile(source: string, sourceName: string): RunFileRead {
	let candidate: unknown;
	try {
		candidate = JSON.parse(source);
	} catch (cause) {
		throw new RunFileRejectedError("read_rejected", sourceName, "invalid saved run JSON", { cause });
	}
	const parsed = RunFileReadSchema.safeParse(candidate);
	if (!parsed.success) {
		throw new RunFileRejectedError("read_rejected", sourceName, parsed.error.message);
	}
	return parsed.data;
}

export async function loadRunFile(runId: string, resultsDirectory: string): Promise<RunFileRead> {
	const validatedId = validateRunId(runId);
	const path = join(resultsDirectory, `${validatedId}.json`);
	let source: string;
	try {
		source = await readFile(path, "utf8");
	} catch (error: unknown) {
		if (hasErrorCode(error, "ENOENT")) throw new SavedRunNotFoundError(validatedId);
		throw error;
	}
	const run = parseRunFile(source, path);
	if (run.id !== validatedId) throw new RunFileRejectedError("read_rejected", path, "run id differs from filename");
	return run;
}

export async function listRunFiles(resultsDirectory: string): Promise<RunFileRead[]> {
	let entries;
	try {
		entries = await readdir(resultsDirectory, { withFileTypes: true });
	} catch (error: unknown) {
		if (hasErrorCode(error, "ENOENT")) return [];
		throw error;
	}
	const runs: RunFileRead[] = [];
	for (const entry of entries.filter((candidate) => candidate.isFile() && candidate.name.endsWith(".json"))) {
		const path = join(resultsDirectory, entry.name);
		try {
			runs.push(parseRunFile(await readFile(path, "utf8"), path));
		} catch (error: unknown) {
			if (!(error instanceof RunFileRejectedError)) throw error;
			process.stderr.write(`Rejected saved run ${path}: ${error.message}\n`);
		}
	}
	return runs.sort((left, right) => right.id.localeCompare(left.id));
}
