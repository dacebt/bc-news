import {
	ACTIVE_REGION_IDS,
	GenerationRunParamsSchema,
	type GenerationRunParams,
} from "@bc-news/contracts";
import { generationRunInstanceId } from "./generation-run";
import { queueGenerationRunStatus, recordGenerationRunFailure } from "./generation-run-status";

const ActiveGenerationRunParamsSchema = GenerationRunParamsSchema.superRefine((params, context) => {
	if (!ACTIVE_REGION_IDS.includes(params.active_region_id)) {
		context.addIssue({
			code: "custom",
			path: ["active_region_id"],
			message: "Active region is not enabled",
		});
	}
});

export class InvalidGenerationRunParamsError extends Error {
	readonly issues: readonly unknown[];

	constructor(issues: readonly unknown[]) {
		super("Generation run params rejected");
		this.name = "InvalidGenerationRunParamsError";
		this.issues = issues;
	}
}

export interface GenerationRunLaunch {
	outcome: "created";
	id: string;
	params: GenerationRunParams;
}

export async function launchGenerationRun(
	rawParams: unknown,
	workflow: Workflow<GenerationRunParams>,
	db: D1Database,
): Promise<GenerationRunLaunch> {
	const result = ActiveGenerationRunParamsSchema.safeParse(rawParams);
	if (!result.success) {
		throw new InvalidGenerationRunParamsError(result.error.issues);
	}
	const params = result.data;
	const instanceId = generationRunInstanceId(params);
	const queuedAtUtc = new Date().toISOString();
	const inserted = await queueGenerationRunStatus(db, params, queuedAtUtc);

	try {
		// The status insert is an observation, not launch authority. Always ask
		// the platform for the deterministic Workflow id so its same-id behavior
		// owns duplicate delivery; an existing status row must not suppress that
		// request or become a repository-invented duplicate classification.
		await workflow.create({ id: instanceId, params });
	} catch (error) {
		if (inserted) {
			try {
				await recordGenerationRunFailure(
					db,
					params,
					{
						step: "launch-generation-run",
						code: error instanceof Error ? error.name : "UnknownError",
						message: error instanceof Error ? error.message : String(error),
					},
					new Date().toISOString(),
				);
			} catch (statusError) {
				throw new AggregateError(
					[error, statusError],
					`Workflow creation and launch-failure status recording both failed for ${instanceId}`,
					{ cause: statusError },
				);
			}
		}
		throw error;
	}
	return { outcome: "created", id: instanceId, params };
}
