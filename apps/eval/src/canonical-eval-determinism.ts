import { allDifferences } from "./run-difference";
import { normalizeRunComparisonTimes } from "./comparison-time";
import type { RunFile } from "./run-file";

/** Two executions may differ only in run identity and generated wall-clock fields. */
export function assertCanonicalEvalDeterminism(first: RunFile, second: RunFile): void {
	const differences = allDifferences(
		normalizeRunComparisonTimes(first),
		normalizeRunComparisonTimes(second),
		["id", "started_at", "completed_at"],
	);
	if (differences.length > 0) {
		throw new Error(`canonical replay is not deterministic: ${differences.join(", ")}`);
	}
}
