import { V9BenchmarkRunSchema, type V9BenchmarkRun, type V9EvaluationTrial } from "./evaluation-artifact-v9";
import { EvaluationArtifactStore } from "./evaluation-artifact-store";

type BenchmarkMutation<T> = (
	current: V9BenchmarkRun,
) => { readonly next: V9BenchmarkRun; readonly result: T };

type TrialMutation<T> = (
	current: V9EvaluationTrial,
) => { readonly next: V9EvaluationTrial; readonly result: T };

export interface TrialMutationController {
	readonly trialId: string;
	currentBenchmark(): V9BenchmarkRun;
	retainedTrial(retainedBenchmark: V9BenchmarkRun): V9EvaluationTrial;
	enqueueMutation<T>(derive: BenchmarkMutation<T>): Promise<T>;
	updateTrial<T>(derive: TrialMutation<T>): Promise<T>;
}

export function createTrialMutationController(input: {
	benchmark: V9BenchmarkRun;
	store: EvaluationArtifactStore;
	trialId: string;
}): TrialMutationController {
	let benchmark = input.benchmark;
	let mutationTail = Promise.resolve();
	let mutationFailed = false;
	let mutationFailure: unknown;

	function retainedTrial(retainedBenchmark: V9BenchmarkRun): V9EvaluationTrial {
		const retained = retainedBenchmark.trials.find(({ id }) => id === input.trialId);
		if (
			retained === undefined ||
			retainedBenchmark.trials.at(-1)?.id !== input.trialId
		) {
			throw new Error(
				`Evaluation trial ${input.trialId} is not the final running trial`,
			);
		}
		return retained;
	}

	function currentBenchmark(): V9BenchmarkRun {
		return benchmark;
	}

	function enqueueMutation<T>(derive: BenchmarkMutation<T>): Promise<T> {
		const operation = mutationTail.then(async () => {
			if (mutationFailed) {
				throw mutationFailure;
			}
			try {
				const mutation = derive(benchmark);
				const next = V9BenchmarkRunSchema.parse(mutation.next);
				await input.store.replace(next);
				benchmark = next;
				return mutation.result;
			} catch (error: unknown) {
				mutationFailed = true;
				mutationFailure = error;
				throw error;
			}
		});
		mutationTail = operation.then(() => undefined, () => undefined);
		return operation;
	}

	function updateTrial<T>(derive: TrialMutation<T>): Promise<T> {
		return enqueueMutation((currentBenchmarkState) => {
			const mutation = derive(retainedTrial(currentBenchmarkState));
			return {
				next: {
					...currentBenchmarkState,
					trials: currentBenchmarkState.trials.map((candidate) =>
						candidate.id === input.trialId ? mutation.next : candidate,
					),
				},
				result: mutation.result,
			};
		});
	}

	return {
		trialId: input.trialId,
		currentBenchmark,
		retainedTrial,
		enqueueMutation,
		updateTrial,
	};
}
