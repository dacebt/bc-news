import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { CAPABILITY_ROSTER } from "./capability-runners";
import { EvalConfigSchema } from "./config";
import { RunFingerprintSchema, Sha256HashSchema } from "./fingerprint";
import { rubricWeightedAggregate } from "./rubrics";

export const RunIdSchema = z.string().regex(
	/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/,
	"Run id must be 1-200 characters, start with a letter or number, and contain only letters, numbers, underscores, and hyphens",
);

export const CheckResultSchema = z.strictObject({
	name: z.enum(["injection", "grounding", "schema", "formatting", "stage_specific"]),
	passed: z.boolean(),
	detail: z.string(),
});

const EditorialCapabilitySchema = z.enum(CAPABILITY_ROSTER);

const JudgeScoreSchema = z.number().int().min(1).max(5);

export const JudgeStepSchema = z
	.strictObject({
		scores: z.strictObject({
			grounding: JudgeScoreSchema,
			voice: JudgeScoreSchema,
			structure: JudgeScoreSchema,
		}),
		reasoning: z.string().trim().min(1),
		aggregate: z.number(),
		weighting: z.literal("v1_rubric_weighted_mean"),
		provenance: z.strictObject({
			source: z.enum(["recorded_replay", "model_completion"]),
			prompt_sha256: Sha256HashSchema,
			response_sha256: Sha256HashSchema,
		}),
	})
	.superRefine((judge, context) => {
		const expected = rubricWeightedAggregate("main_story", judge.scores);
		if (Math.abs(judge.aggregate - expected) > Number.EPSILON) {
			context.addIssue({
				code: "custom",
				path: ["aggregate"],
				message: `aggregate must equal the v1 rubric-weighted score ${expected}`,
			});
		}
	});
export type JudgeStep = z.infer<typeof JudgeStepSchema>;

export const RunStepSchema = z.strictObject({
	capability: z.literal("main_story").pipe(EditorialCapabilitySchema),
	prompt_sha256: Sha256HashSchema,
	output: z.record(z.string(), z.unknown()),
	schema_valid: z.boolean(),
	checks: z.array(CheckResultSchema).optional(),
	judge: JudgeStepSchema.nullable(),
});

/**
 * Write-path schema: strict, rejects anything unexpected. The companion
 * read-path schema below is deliberately looser so runs saved by an earlier
 * shape of this file stay readable as the format grows.
 */
export const RunFileSchema = z
	.strictObject({
		id: RunIdSchema,
		config: EvalConfigSchema,
		fixture: z.strictObject({ path: z.string().min(1), fixture_sha256: Sha256HashSchema }),
		steps: z.array(RunStepSchema).min(1),
		started_at: z.iso.datetime({ offset: true }),
		completed_at: z.iso.datetime({ offset: true }),
		fingerprint: RunFingerprintSchema,
	})
	// fixture.fixture_sha256 and fingerprint.fixture_sha256 encode the same
	// fact (the fixture bytes the run consumed) in two places; a run file
	// carrying two disagreeing copies is not a valid run file.
	.refine((run) => run.fixture.fixture_sha256 === run.fingerprint.fixture_sha256, {
		message: "fixture.fixture_sha256 and fingerprint.fixture_sha256 must match",
		path: ["fixture", "fixture_sha256"],
	});
export type RunFile = z.infer<typeof RunFileSchema>;

const ReadStepSchema = z.looseObject({
	capability: z.string(),
	prompt_sha256: z.string().optional(),
	output: z.unknown().optional(),
	schema_valid: z.boolean().optional(),
	checks: z.array(z.looseObject({ name: z.string(), passed: z.boolean(), detail: z.string().optional() })).optional(),
	judge: z.unknown().nullable().optional(),
});

export const RunFileReadSchema = z
	.looseObject({
		id: RunIdSchema,
		config: z.unknown().optional(),
		fixture: z.looseObject({ path: z.string(), fixture_sha256: z.string() }).optional(),
		steps: z.array(ReadStepSchema).default([]),
		started_at: z.string().optional(),
		completed_at: z.string().optional(),
		fingerprint: z
			.looseObject({
				provider_params: z.unknown().optional(),
				fixture_sha256: z.string().optional(),
				checks_sha256: z.string().optional(),
				providers_sha256: z.string().optional(),
				rubrics_sha256: z.string().optional(),
				schemas_sha256: z.string().optional(),
				code_version: z.string().nullable().optional(),
			})
			.optional(),
	})
	// Same reconciliation as the write path, relaxed for optionality: an older
	// run missing one of the two copies stays readable, but a run carrying
	// both must not disagree on which fixture it ran against.
	.refine(
		(run) =>
			run.fixture?.fixture_sha256 === undefined ||
			run.fingerprint?.fixture_sha256 === undefined ||
			run.fixture.fixture_sha256 === run.fingerprint.fixture_sha256,
		{
			message: "fixture.fixture_sha256 and fingerprint.fixture_sha256 disagree",
			path: ["fixture", "fixture_sha256"],
		},
	);
export type RunFileRead = z.infer<typeof RunFileReadSchema>;

export class InvalidRunIdError extends Error {
	readonly code = "invalid_run_id";
	readonly runId: string;

	constructor(runId: string) {
		super(`Invalid run id: ${runId}`);
		this.name = "InvalidRunIdError";
		this.runId = runId;
	}
}

export class SavedRunNotFoundError extends Error {
	readonly code = "saved_run_not_found";
	readonly runId: string;

	constructor(runId: string) {
		super(`Saved run not found: ${runId}`);
		this.name = "SavedRunNotFoundError";
		this.runId = runId;
	}
}

export class RunFileRejectedError extends Error {
	readonly code: "write_rejected" | "read_rejected";
	readonly source: string;

	constructor(
		code: "write_rejected" | "read_rejected",
		source: string,
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "RunFileRejectedError";
		this.code = code;
		this.source = source;
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

/** Sanitized ISO timestamp: colons and dots (illegal/awkward in filenames) become hyphens. */
export function generateRunId(): string {
	return new Date().toISOString().replace(/[:.]/g, "-");
}

const MAX_SAVE_ATTEMPTS = 10;

/**
 * `wx` guarantees no run ever overwrites another, but generateRunId()'s
 * millisecond resolution means concurrent runs can collide on id before
 * either writes. A losing run has already paid for every provider call and
 * check by the time saveRunFile is reached, so collision retries with a
 * disambiguated id (base id + attempt suffix) rather than discarding that
 * work; only exhausting all attempts is a real, reported failure.
 */
export async function saveRunFile(run: RunFile, resultsDirectory: string): Promise<string> {
	const validated = RunFileSchema.safeParse(run);
	if (!validated.success) {
		throw new RunFileRejectedError("write_rejected", run.id, `Run file rejected: ${validated.error.message}`);
	}
	await mkdir(resultsDirectory, { recursive: true });

	let candidate = validated.data;
	for (let attempt = 1; attempt <= MAX_SAVE_ATTEMPTS; attempt++) {
		const outputPath = join(resultsDirectory, `${candidate.id}.json`);
		try {
			await writeFile(outputPath, `${JSON.stringify(candidate, null, 2)}\n`, {
				encoding: "utf8",
				flag: "wx",
			});
			return outputPath;
		} catch (error: unknown) {
			if (!hasErrorCode(error, "EEXIST")) throw error;
			candidate = { ...candidate, id: `${validated.data.id}-${attempt + 1}` };
		}
	}
	throw new RunFileRejectedError(
		"write_rejected",
		validated.data.id,
		`Run file rejected: id ${validated.data.id} collided with an existing run ${MAX_SAVE_ATTEMPTS} times in a row`,
	);
}

function parseRunFile(source: string, sourceName: string): RunFileRead {
	let candidate: unknown;
	try {
		candidate = JSON.parse(source);
	} catch (cause) {
		throw new RunFileRejectedError("read_rejected", sourceName, `Invalid saved run JSON in ${sourceName}`, {
			cause,
		});
	}
	const parsed = RunFileReadSchema.safeParse(candidate);
	if (!parsed.success) {
		throw new RunFileRejectedError(
			"read_rejected",
			sourceName,
			`Invalid saved run in ${sourceName}: ${parsed.error.message}`,
		);
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
	if (run.id !== validatedId) {
		throw new RunFileRejectedError(
			"read_rejected",
			path,
			`Saved run id ${run.id} does not match filename id ${validatedId}`,
		);
	}
	return run;
}

/**
 * The results directory is committed repo evidence a human will drop files
 * into (AppleDouble sidecars from macOS copies, an ad hoc summary.json,
 * anything else that ends in .json but isn't a run). Filtering candidates by
 * filename shape before reading them would also reject a run file saved
 * under an older id format -- exactly the case RunFileReadSchema's
 * permissiveness exists to keep readable. So every *.json file is a
 * candidate; each is parsed independently under the permissive read schema,
 * and a file that isn't a valid run is skipped (reported, not silently
 * dropped) rather than aborting the whole listing.
 */
export async function listRunFiles(resultsDirectory: string): Promise<RunFileRead[]> {
	let entries;
	try {
		entries = await readdir(resultsDirectory, { withFileTypes: true });
	} catch (error: unknown) {
		if (hasErrorCode(error, "ENOENT")) return [];
		throw error;
	}
	const candidates = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
	const runs: RunFileRead[] = [];
	for (const entry of candidates) {
		const path = join(resultsDirectory, entry.name);
		let source: string;
		try {
			source = await readFile(path, "utf8");
		} catch (error: unknown) {
			if (hasErrorCode(error, "ENOENT")) continue;
			throw error;
		}
		try {
			runs.push(parseRunFile(source, path));
		} catch (error: unknown) {
			if (!(error instanceof RunFileRejectedError)) throw error;
			process.stderr.write(`eval: skipping ${path}, not a valid run file: ${error.message}\n`);
		}
	}
	return runs.sort((left, right) => right.id.localeCompare(left.id));
}
