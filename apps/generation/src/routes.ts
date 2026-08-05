import { z } from "zod";
import { GenerationRunParamsSchema } from "@bc-news/contracts";
import { EditionUnreadableError, readEdition } from "./edition-store";
import { generationRunInstanceId } from "./generation-run";
import {
	GenerationRunProjectionSchema,
	GenerationRunStatusUnreadableError,
	readGenerationRunStatus,
} from "./generation-run-status";
import { InvalidGenerationRunParamsError, launchGenerationRun } from "./run-launch";

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json", ...headers },
	});
}

function errorShape(error: unknown): { name: string; message: string } {
	if (error instanceof Error) {
		return { name: error.name, message: error.message };
	}
	return { name: "UnknownError", message: String(error) };
}

const WorkflowInstanceStateSchema = z.enum([
	"queued",
	"running",
	"paused",
	"errored",
	"terminated",
	"complete",
	"waiting",
	"waitingForPause",
	"unknown",
]);
const ErrorShapeSchema = z.strictObject({ name: z.string(), message: z.string() });
const WorkflowStatusBoundarySchema = z.strictObject({
	status: WorkflowInstanceStateSchema,
	error: ErrorShapeSchema.optional(),
	output: z.unknown().optional(),
	__LOCAL_DEV_STEP_OUTPUTS: z.array(z.unknown()).optional(),
});
const WorkflowObservationSchema = z.discriminatedUnion("observation", [
	z.strictObject({
		observation: z.literal("available"),
		status: WorkflowInstanceStateSchema,
		error: ErrorShapeSchema.nullable(),
	}),
	z.strictObject({
		observation: z.literal("unavailable"),
		error: ErrorShapeSchema,
	}),
]);
export const GenerationRunStatusResponseSchema = GenerationRunProjectionSchema.extend({
	generation_run_id: z.string().min(1),
	workflow: WorkflowObservationSchema,
});

export async function createGenerationRun(request: Request, env: Env): Promise<Response> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return jsonResponse(400, {
			error: "invalid_generation_run_params",
			detail: "Request body is not valid JSON",
		});
	}
	let launch;
	try {
		launch = await launchGenerationRun(body, env.GENERATION_RUN, env.DB);
	} catch (error) {
		if (error instanceof InvalidGenerationRunParamsError) {
			return jsonResponse(400, {
				error: "invalid_generation_run_params",
				issues: error.issues,
			});
		}
		throw error;
	}
	return jsonResponse(202, {
		id: launch.id,
		active_region_id: launch.params.active_region_id,
		publication_date: launch.params.publication_date,
	});
}

export async function getGenerationRunStatus(instanceId: string, env: Env): Promise<Response> {
	let instance: WorkflowInstance;
	try {
		instance = await env.GENERATION_RUN.get(instanceId);
	} catch (error) {
		return jsonResponse(404, {
			error: "generation_run_not_found",
			id: instanceId,
			platform_error: errorShape(error),
		});
	}
	return jsonResponse(200, { id: instanceId, status: await instance.status() });
}

export async function getGenerationRunStatusByPair(url: URL, env: Env): Promise<Response> {
	const paramsResult = GenerationRunParamsSchema.safeParse({
		active_region_id: url.searchParams.get("active_region_id"),
		publication_date: url.searchParams.get("publication_date"),
	});
	if (!paramsResult.success) {
		return jsonResponse(400, {
			error: "invalid_generation_run_params",
			issues: paramsResult.error.issues,
		});
	}
	const params = paramsResult.data;
	let projection;
	try {
		projection = await readGenerationRunStatus(env.DB, params);
	} catch (error) {
		if (error instanceof GenerationRunStatusUnreadableError) {
			return jsonResponse(500, {
				error: "generation_run_status_unreadable",
				...params,
			});
		}
		throw error;
	}
	if (projection === undefined) {
		return jsonResponse(404, { error: "generation_run_not_found", ...params });
	}

	const generationRunId = generationRunInstanceId(params);
	let workflow: z.infer<typeof WorkflowObservationSchema>;
	try {
		const instance = await env.GENERATION_RUN.get(generationRunId);
		const observed = WorkflowStatusBoundarySchema.parse(await instance.status());
		workflow = {
			observation: "available",
			status: observed.status,
			error: observed.error ?? null,
		};
	} catch (error) {
		if (error instanceof z.ZodError) throw error;
		workflow = { observation: "unavailable", error: errorShape(error) };
	}
	const response = GenerationRunStatusResponseSchema.parse({
		...projection,
		generation_run_id: generationRunId,
		workflow,
	});
	return jsonResponse(200, response);
}

export async function getPublishedEdition(url: URL, env: Env): Promise<Response> {
	const result = GenerationRunParamsSchema.safeParse({
		active_region_id: url.searchParams.get("active_region_id"),
		publication_date: url.searchParams.get("publication_date"),
	});
	if (!result.success) {
		return jsonResponse(400, {
			error: "invalid_edition_request",
			issues: result.error.issues,
		});
	}
	const { active_region_id, publication_date } = result.data;

	let edition;
	try {
		edition = await readEdition(env.DB, active_region_id, publication_date);
	} catch (error) {
		if (error instanceof EditionUnreadableError) {
			return jsonResponse(500, { error: "edition_unreadable" });
		}
		throw error;
	}
	if (edition === undefined) {
		return jsonResponse(404, { error: "edition_not_found" });
	}
	return jsonResponse(200, edition, { "Cache-Control": "public, max-age=3600" });
}
