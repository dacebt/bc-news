import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { EvaluationIdSchema } from "./evaluation-artifact-schemas";
import {
	EvaluationAggregateResultError,
	EvaluationAggregateResultSchema,
	type EvaluationAggregateResult,
} from "./evaluation-aggregate-result";

function fail(
	code: EvaluationAggregateResultError["code"],
	path: string,
	message: string,
	cause?: unknown,
): never {
	throw new EvaluationAggregateResultError(
		code,
		path,
		message,
		cause === undefined ? undefined : { cause },
	);
}

function aggregatePath(id: string, resultsDirectory: string): string {
	return join(resultsDirectory, `${id}.json`);
}

function validateAggregateResultArtifact(
	candidate: unknown,
	path: string,
	invalidCode: "aggregate_result_invalid" | "aggregate_result_create_rejected",
): EvaluationAggregateResult {
	const result = EvaluationAggregateResultSchema.safeParse(candidate);
	if (!result.success) {
		fail(invalidCode, path, `Aggregate result contract rejected: ${result.error.message}`, result.error);
	}
	return result.data;
}

export async function createEvaluationAggregateResultArtifact(
	artifact: EvaluationAggregateResult,
	resultsDirectory: string,
): Promise<string> {
	await mkdir(resultsDirectory, { recursive: true });
	const path = aggregatePath(artifact.id, resultsDirectory);
	const candidate = validateAggregateResultArtifact(
		artifact,
		path,
		"aggregate_result_create_rejected",
	);
	try {
		await writeFile(path, `${JSON.stringify(candidate, null, 2)}\n`, {
			encoding: "utf8",
			flag: "wx",
		});
	} catch (cause) {
		return fail(
			"aggregate_result_create_rejected",
			path,
			"Could not exclusively create aggregate result artifact",
			cause,
		);
	}
	try {
		await loadEvaluationAggregateResultArtifact(candidate.id, dirname(path));
		return path;
	} catch (cause) {
		try {
			await unlink(path);
		} catch {
			/* create failure remains authoritative */
		}
		return fail(
			"aggregate_result_create_rejected",
			path,
			"Aggregate result read-after-write validation failed",
			cause,
		);
	}
}

export async function loadEvaluationAggregateResultArtifact(
	id: string,
	resultsDirectory: string,
): Promise<EvaluationAggregateResult> {
	const parsedId = EvaluationIdSchema.safeParse(id);
	if (!parsedId.success) {
		fail(
			"invalid_aggregate_result_id",
			resultsDirectory,
			`Invalid aggregate result id: ${id}`,
			parsedId.error,
		);
	}
	const path = aggregatePath(parsedId.data, resultsDirectory);
	let raw: Uint8Array;
	try {
		raw = await readFile(path);
	} catch (cause) {
		return fail(
			(cause as NodeJS.ErrnoException).code === "ENOENT"
				? "aggregate_result_not_found"
				: "aggregate_result_invalid",
			path,
			"Cannot read aggregate result artifact",
			cause,
		);
	}
	let candidate: unknown;
	try {
		candidate = JSON.parse(Buffer.from(raw).toString("utf8")) as unknown;
	} catch (cause) {
		return fail("aggregate_result_malformed", path, "Malformed aggregate result JSON", cause);
	}
	const artifact = validateAggregateResultArtifact(
		candidate,
		path,
		"aggregate_result_invalid",
	);
	if (artifact.id !== parsedId.data) {
		fail(
			"aggregate_result_filename_mismatch",
			path,
			"Aggregate result filename identity mismatch",
		);
	}
	return artifact;
}
