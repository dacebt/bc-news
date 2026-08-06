import {
	compareRetainedFinalEditorialProducts,
} from "./final-product-comparison";
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
		differences: compareRetainedFinalEditorialProducts(left, right).differences,
	};
}
