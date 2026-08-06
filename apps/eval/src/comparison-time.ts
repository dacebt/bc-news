import type { RunFileRead } from "./run-file";

const COMPARISON_TIME = "1970-01-01T00:00:00.000Z";

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Removes wall-clock edition generation time from run comparisons. */
export function normalizeRunComparisonTimes(run: RunFileRead): RunFileRead {
	if (!isPlainObject(run.edition) || !isPlainObject(run.edition.meta)) return run;
	return {
		...run,
		edition: {
			...run.edition,
			meta: { ...run.edition.meta, generated_at_utc: COMPARISON_TIME },
		},
	};
}
