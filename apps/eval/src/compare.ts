import { allDifferences } from "./run-difference";
import { normalizeRunComparisonTimes } from "./comparison-time";
import type { RunFileRead } from "./run-file";

export interface RunComparison {
	readonly leftId: string;
	readonly rightId: string;
	readonly differences: readonly string[];
}

export function compareRuns(left: RunFileRead, right: RunFileRead): RunComparison {
	return {
		leftId: left.id,
		rightId: right.id,
		differences: allDifferences(
			normalizeRunComparisonTimes(left),
			normalizeRunComparisonTimes(right),
			["id", "started_at", "completed_at"],
		),
	};
}
