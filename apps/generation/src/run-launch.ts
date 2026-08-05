import { GenerationRunParamsSchema, type GenerationRunParams } from "@bc-news/contracts";
import { generationRunInstanceId } from "./generation-run";
import { queueGenerationRunStatus, recordGenerationRunFailure } from "./generation-run-status";

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
	const result = GenerationRunParamsSchema.safeParse(rawParams);
	if (!result.success) {
		throw new InvalidGenerationRunParamsError(result.error.issues);
	}
	const params = result.data;
	const instanceId = generationRunInstanceId(params);
	const queuedAtUtc = new Date().toISOString();
	const inserted = await queueGenerationRunStatus(db, params, queuedAtUtc);

	try {
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
