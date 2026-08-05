import {
	ACTIVE_REGION_IDS,
	PublicationDateSchema,
	type GenerationRunParams,
	type PublicationDate,
} from "@bc-news/contracts";
import { launchGenerationRun, type GenerationRunLaunch } from "./run-launch";

type GenerationRunLauncher = (
	params: GenerationRunParams,
	workflow: Workflow<GenerationRunParams>,
	db: D1Database,
) => Promise<GenerationRunLaunch>;

export function publicationDateForScheduledTime(scheduledTime: number): PublicationDate {
	const instant = new Date(scheduledTime);
	const candidate = Number.isFinite(scheduledTime) && !Number.isNaN(instant.getTime())
		? instant.toISOString().slice(0, 10)
		: "";
	const result = PublicationDateSchema.safeParse(candidate);
	if (!result.success) {
		throw new Error(
			`Scheduled time ${JSON.stringify(scheduledTime)} did not derive a valid UTC publication date`,
			{ cause: result.error },
		);
	}
	return result.data;
}

export async function scheduleGenerationRuns(
	scheduledTime: number,
	env: Pick<Env, "GENERATION_RUN" | "DB">,
	launcher: GenerationRunLauncher = launchGenerationRun,
): Promise<readonly GenerationRunLaunch[]> {
	const publicationDate = publicationDateForScheduledTime(scheduledTime);
	const attempts = await Promise.all(
		ACTIVE_REGION_IDS.map(async (activeRegionId) => {
			const params: GenerationRunParams = {
				active_region_id: activeRegionId,
				publication_date: publicationDate,
			};
			try {
				return { result: await launcher(params, env.GENERATION_RUN, env.DB) } as const;
			} catch (error) {
				return { error, params } as const;
			}
		}),
	);
	const failures = attempts.filter(
		(attempt): attempt is { error: unknown; params: GenerationRunParams } => "error" in attempt,
	);
	if (failures.length > 0) {
		const failedPairs = failures
			.map(({ params }) => `${params.active_region_id}/${params.publication_date}`)
			.join(", ");
		throw new AggregateError(
			failures.map(({ error, params }) =>
				new Error(
					`Generation launch failed for active region ${params.active_region_id} on publication date ${params.publication_date}`,
					{ cause: error },
				),
			),
			`Scheduled generation launch failed for ${failedPairs}`,
		);
	}
	const successes = attempts.filter(
		(attempt): attempt is { result: GenerationRunLaunch } => "result" in attempt,
	);
	return successes.map((attempt) => attempt.result);
}
