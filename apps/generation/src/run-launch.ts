import { GenerationRunParamsSchema, type GenerationRunParams } from "@bc-news/contracts";
import { generationRunInstanceId } from "./generation-run";

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
): Promise<GenerationRunLaunch> {
	const result = GenerationRunParamsSchema.safeParse(rawParams);
	if (!result.success) {
		throw new InvalidGenerationRunParamsError(result.error.issues);
	}
	const params = result.data;
	const instanceId = generationRunInstanceId(params);

	await workflow.create({ id: instanceId, params });
	return { outcome: "created", id: instanceId, params };
}
