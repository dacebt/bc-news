import { allDifferences } from "./run-difference";
import type { EvaluationAggregateResult } from "./evaluation-aggregate-result";

export interface EvaluationAggregateResultComparison {
	readonly leftId: string;
	readonly rightId: string;
	readonly differences: readonly string[];
}

function aggregateDifferences(left: EvaluationAggregateResult, right: EvaluationAggregateResult): readonly string[] {
	return allDifferences(left, right).map((path) => path.replace(/^run/u, "aggregate"));
}

export function compareEvaluationAggregateResults(
	left: EvaluationAggregateResult,
	right: EvaluationAggregateResult,
): EvaluationAggregateResultComparison {
	return {
		leftId: left.id,
		rightId: right.id,
		differences: aggregateDifferences(left, right),
	};
}

export function formatEvaluationAggregateResultComparison(
	comparison: EvaluationAggregateResultComparison,
): string {
	return comparison.differences.length === 0
		? [
			`Left aggregate result: ${comparison.leftId}`,
			`Right aggregate result: ${comparison.rightId}`,
			"Aggregate differences: none",
		].join("\n")
		: [
			`Left aggregate result: ${comparison.leftId}`,
			`Right aggregate result: ${comparison.rightId}`,
			"Aggregate differences:",
			...comparison.differences.map((path) => `- ${path}`),
		].join("\n");
}
