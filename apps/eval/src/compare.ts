import type { EditorialDiagnostic } from "@bc-news/generation-core";
import {
	compareRetainedFinalEditorialProducts,
} from "./final-product-comparison";
import { allDifferences } from "./run-difference";
import type { RunFileRead } from "./run-file";

export interface RunComparison {
	readonly leftId: string;
	readonly rightId: string;
	readonly differences: readonly string[];
	readonly leftDiagnostics?: readonly EditorialDiagnostic[];
	readonly rightDiagnostics?: readonly EditorialDiagnostic[];
}

export function compareRuns(left: RunFileRead, right: RunFileRead): RunComparison {
	const productDifferences = compareRetainedFinalEditorialProducts(left, right).differences;
	const diagnosticDifferences = left.diagnostics === undefined || right.diagnostics === undefined
		? []
		: allDifferences(
			{ diagnostics: left.diagnostics },
			{ diagnostics: right.diagnostics },
		);
	return {
		leftId: left.id,
		rightId: right.id,
		differences: [...productDifferences, ...diagnosticDifferences],
		...(left.diagnostics === undefined ? {} : { leftDiagnostics: left.diagnostics }),
		...(right.diagnostics === undefined ? {} : { rightDiagnostics: right.diagnostics }),
	};
}
