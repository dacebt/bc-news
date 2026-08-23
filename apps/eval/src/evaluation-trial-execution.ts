import {
	WRITER_SYSTEM_CONSTRAINTS,
	buildAnnouncementsWriterPrompt,
	buildMainStoryWriterPrompt,
	mainStoryFinalProductDiagnostics,
	announcementsFinalProductDiagnostics,
	parseAnnouncementsWriterOutput,
	parseMainStoryWriterOutput,
	type AnnouncementsProduct,
	type MainStoryProduct,
	type ModelProviderPort,
	type PreparedEvidence,
} from "@bc-news/generation-core";
import {
	deriveCurrentTrialOutcome,
	type V9BenchmarkRun,
	type V9EvaluationTrial,
} from "./evaluation-artifact-v9";
import { EvaluationArtifactStore } from "./evaluation-artifact-store";
import type { CurrentProductionModelStep } from "./current-production-steps";
import { invokeTrialStep } from "./evaluation-trial-invocation";
import { createTrialMutationController } from "./evaluation-trial-mutation";
import {
	EvaluationRuntimeEvidenceError,
	requireRuntimeEvidence,
} from "./evaluation-trial-runtime-evidence";
export {
	EvaluationRuntimeEvidenceError,
	requireRuntimeEvidence,
};
import {
	terminalCurrentTrackOutcome,
} from "./evaluation-trial-support";

type TrackName = keyof V9EvaluationTrial["tracks"];

export async function executeEvaluationTrial(input: {
	benchmark: V9BenchmarkRun;
	store: EvaluationArtifactStore;
	preparedEvidence: PreparedEvidence;
	providers: Record<CurrentProductionModelStep, ModelProviderPort>;
	configIdentity: string;
	trialId?: string;
	transportRetryLimit?: number;
}): Promise<V9BenchmarkRun> {
	const trialId = input.trialId ?? input.benchmark.trials[0]!.id;
	const mutation = createTrialMutationController({
		benchmark: input.benchmark,
		store: input.store,
		trialId,
	});

	async function setTrack(
		track: TrackName,
		state: V9EvaluationTrial["tracks"][typeof track],
	): Promise<void> {
		await mutation.updateTrial((current) => ({
			next: { ...current, tracks: { ...current.tracks, [track]: state } },
			result: undefined,
		}));
	}

	async function rejectTrack(
		track: TrackName,
		productionStep: CurrentProductionModelStep,
	): Promise<void> {
		await mutation.updateTrial((current) => ({
			next: {
				...current,
				tracks: {
					...current.tracks,
					[track]: {
						...current.tracks[track],
						lifecycle: "rejected",
						subject_outcome: terminalCurrentTrackOutcome(current, track),
						terminal_production_step: productionStep,
					},
				},
			},
			result: undefined,
		}));
	}

	async function runMainStoryTrack(): Promise<void> {
		const mainStory = await invokeTrialStep<MainStoryProduct>({
			mutation,
			benchmarkId: input.benchmark.id,
			configIdentity: input.configIdentity,
			providers: input.providers,
			transportRetryLimit: input.transportRetryLimit,
			productionStep: "main_story_write",
			system: WRITER_SYSTEM_CONSTRAINTS,
			user: buildMainStoryWriterPrompt(input.preparedEvidence),
			parse: (completion) =>
				parseMainStoryWriterOutput(completion.text, input.preparedEvidence),
			requireRuntimeEvidence,
		});
		if (mainStory === undefined) {
			await rejectTrack("main_story", "main_story_write");
			return;
		}
		await setTrack("main_story", {
			lifecycle: "completed",
			subject_outcome: "completed",
			terminal_production_step: "main_story_write",
			product: mainStory,
			findings: [
				...mainStoryFinalProductDiagnostics(
					mainStory,
					input.preparedEvidence,
				),
			],
		});
	}

	async function runAnnouncementsTrack(): Promise<void> {
		const announcements = await invokeTrialStep<AnnouncementsProduct>({
			mutation,
			benchmarkId: input.benchmark.id,
			configIdentity: input.configIdentity,
			providers: input.providers,
			transportRetryLimit: input.transportRetryLimit,
			productionStep: "announcements_write",
			system: WRITER_SYSTEM_CONSTRAINTS,
			user: buildAnnouncementsWriterPrompt(input.preparedEvidence),
			parse: (completion) =>
				parseAnnouncementsWriterOutput(completion.text, input.preparedEvidence),
			requireRuntimeEvidence,
		});
		if (announcements === undefined) {
			await rejectTrack("announcements", "announcements_write");
			return;
		}
		await setTrack("announcements", {
			lifecycle: "completed",
			subject_outcome: "completed",
			terminal_production_step: "announcements_write",
			product: announcements,
			findings: [
				...announcementsFinalProductDiagnostics(
					announcements,
					input.preparedEvidence,
				),
			],
		});
	}

	await mutation.updateTrial((current) => ({
		next: {
			...current,
			tracks: {
				main_story: { ...current.tracks.main_story, lifecycle: "running" },
				announcements: {
					...current.tracks.announcements,
					lifecycle: "running",
				},
			},
		},
		result: undefined,
	}));
	const trackResults = await Promise.allSettled([
		runMainStoryTrack(),
		runAnnouncementsTrack(),
	]);
	const failures: unknown[] = [];
	for (const result of trackResults) {
		if (result.status === "rejected") {
			failures.push(result.reason as unknown);
		}
	}
	if (failures.length === 1) {
		throw failures[0];
	}
	if (failures.length === 2) {
		throw new AggregateError(
			failures,
			`Both evaluation tracks failed for ${trialId}`,
		);
	}

	await mutation.enqueueMutation((current) => {
		const currentTrial = mutation.retainedTrial(current);
		const outcome = deriveCurrentTrialOutcome(currentTrial);
		const completedAt = new Date().toISOString();
		const counts = { ...current.outcome_counts };
		counts[outcome] += 1;
		const completedTrial = {
			...currentTrial,
			lifecycle: "complete" as const,
			completed_at: completedAt,
			subject_outcome: outcome,
		};
		return {
			next: {
				...current,
				trials: current.trials.map((candidate) =>
					candidate.id === trialId ? completedTrial : candidate,
				),
				outcome_counts: counts,
			},
			result: undefined,
		};
	});
	return mutation.currentBenchmark();
}
