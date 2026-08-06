import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { BenchmarkRunSchema, type BenchmarkRun } from "./evaluation-artifact";
import { EvaluationIdSchema } from "./evaluation-artifact-schemas";

export type BenchmarkRunReadErrorCode =
	| "invalid_benchmark_id"
	| "benchmark_not_found"
	| "benchmark_directory_unreadable"
	| "benchmark_artifact_unreadable"
	| "benchmark_artifact_malformed"
	| "benchmark_artifact_invalid"
	| "benchmark_filename_mismatch";

export class BenchmarkRunReadError extends Error {
	readonly code: BenchmarkRunReadErrorCode;
	readonly path: string;

	constructor(code: BenchmarkRunReadErrorCode, path: string, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "BenchmarkRunReadError";
		this.code = code;
		this.path = path;
	}
}

function validatedId(id: string, directory: string): string {
	const parsed = EvaluationIdSchema.safeParse(id);
	if (!parsed.success) {
		throw new BenchmarkRunReadError(
			"invalid_benchmark_id",
			directory,
			`Invalid Benchmark Run id: ${id}`,
			{ cause: parsed.error },
		);
	}
	return parsed.data;
}

async function readBenchmarkPath(path: string, expectedId: string): Promise<BenchmarkRun> {
	let bytes: string;
	try {
		bytes = await readFile(path, "utf8");
	} catch (cause) {
		const code = (cause as NodeJS.ErrnoException).code;
		throw new BenchmarkRunReadError(
			code === "ENOENT" ? "benchmark_not_found" : "benchmark_artifact_unreadable",
			path,
			code === "ENOENT" ? `Benchmark Run not found: ${expectedId}` : `Cannot read Benchmark Run: ${path}`,
			{ cause },
		);
	}

	let input: unknown;
	try {
		input = JSON.parse(bytes) as unknown;
	} catch (cause) {
		throw new BenchmarkRunReadError(
			"benchmark_artifact_malformed",
			path,
			`Malformed Benchmark Run JSON: ${path}`,
			{ cause },
		);
	}
	const parsed = BenchmarkRunSchema.safeParse(input);
	if (!parsed.success) {
		throw new BenchmarkRunReadError(
			"benchmark_artifact_invalid",
			path,
			`Invalid Benchmark Run artifact: ${path}`,
			{ cause: parsed.error },
		);
	}
	if (parsed.data.id !== expectedId) {
		throw new BenchmarkRunReadError(
			"benchmark_filename_mismatch",
			path,
			`Benchmark Run filename id ${expectedId} does not match artifact id ${parsed.data.id}`,
		);
	}
	return parsed.data;
}

export async function loadBenchmarkRun(id: string, directory: string): Promise<BenchmarkRun> {
	const expectedId = validatedId(id, directory);
	return readBenchmarkPath(join(directory, `${expectedId}.json`), expectedId);
}

export async function listBenchmarkRuns(directory: string): Promise<BenchmarkRun[]> {
	let names: string[];
	try {
		names = await readdir(directory);
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw new BenchmarkRunReadError(
			"benchmark_directory_unreadable",
			directory,
			`Cannot read Benchmark Run directory: ${directory}`,
			{ cause },
		);
	}

	const jsonNames = names.filter((name) => name.endsWith(".json"));
	const runs = await Promise.all(jsonNames.map(async (name) => {
		const id = validatedId(name.slice(0, -".json".length), directory);
		return readBenchmarkPath(join(directory, name), id);
	}));
	return runs.sort((left, right) => {
		const chronological = Date.parse(right.started_at) - Date.parse(left.started_at);
		return chronological !== 0 ? chronological : right.id.localeCompare(left.id);
	});
}
