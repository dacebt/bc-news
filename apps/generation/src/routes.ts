import { GenerationRunParamsSchema } from "@bc-news/contracts";
import { EditionUnreadableError, readEdition } from "./edition-store";
import { generationRunInstanceId } from "./generation-run";

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

async function existingGenerationRun(
	env: Env,
	instanceId: string,
): Promise<WorkflowInstance | undefined> {
	try {
		return await env.GENERATION_RUN.get(instanceId);
	} catch {
		return undefined;
	}
}

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
	const result = GenerationRunParamsSchema.safeParse(body);
	if (!result.success) {
		return jsonResponse(400, {
			error: "invalid_generation_run_params",
			issues: result.error.issues,
		});
	}
	const params = result.data;
	const instanceId = generationRunInstanceId(params);

	let instance: WorkflowInstance;
	try {
		instance = await env.GENERATION_RUN.create({ id: instanceId, params });
	} catch (createError) {
		const duplicate = await existingGenerationRun(env, instanceId);
		if (duplicate === undefined) {
			throw createError;
		}
		return jsonResponse(409, {
			error: "duplicate_generation_run",
			id: instanceId,
			platform_error: errorShape(createError),
		});
	}
	return jsonResponse(202, {
		id: instance.id,
		active_region_id: params.active_region_id,
		publication_date: params.publication_date,
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
