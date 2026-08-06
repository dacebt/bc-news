import type { BenchmarkRun } from "./evaluation-artifact";
import { projectBenchmarkBehavior, projectBenchmarkContext } from "./evaluation-observation";
import { allDifferences } from "./run-difference";

export interface BenchmarkComparison {
	readonly leftId: string;
	readonly rightId: string;
	readonly leftContext: ReturnType<typeof projectBenchmarkContext>;
	readonly rightContext: ReturnType<typeof projectBenchmarkContext>;
	readonly contextDifferences: readonly string[];
	readonly behavioralDifferences: readonly string[];
}

export function compareBenchmarkRuns(left: BenchmarkRun, right: BenchmarkRun): BenchmarkComparison {
	const leftContext = projectBenchmarkContext(left);
	const rightContext = projectBenchmarkContext(right);
	return {
		leftId: left.id,
		rightId: right.id,
		leftContext,
		rightContext,
		contextDifferences: allDifferences(leftContext, rightContext),
		behavioralDifferences: allDifferences(
			projectBenchmarkBehavior(left),
			projectBenchmarkBehavior(right),
		),
	};
}
