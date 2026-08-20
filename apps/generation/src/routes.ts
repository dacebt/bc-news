import { z } from "zod";
import { GenerationRunParamsSchema } from "@bc-news/contracts";
import { EditionUnreadableError, readEdition } from "./edition-store";
import { generationRunInstanceId } from "./generation-run";
import {
	CurrentGenerationRunProjectionSchema,
	LegacyGenerationRunProjectionSchema,
	GenerationRunStatusUnreadableError,
	readGenerationRunStatus,
} from "./generation-run-status";
import { InvalidGenerationRunParamsError, launchGenerationRun } from "./run-launch";

const MAX_GENERATION_RUN_BODY_BYTES = 1024;

class GenerationRunBodyTooLargeError extends Error {}

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json", ...headers },
	});
}

function hasJsonContentType(request: Request): boolean {
	const contentType = request.headers.get("Content-Type");
	return contentType?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

async function readGenerationRunBody(request: Request): Promise<unknown> {
	if (request.body === null) return undefined;

	const body: ReadableStream<unknown> = request.body;
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let byteLength = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!(value instanceof Uint8Array)) {
			await reader.cancel();
			throw new TypeError("Request body stream did not provide bytes");
		}
		byteLength += value.byteLength;
		if (byteLength > MAX_GENERATION_RUN_BODY_BYTES) {
			await reader.cancel();
			throw new GenerationRunBodyTooLargeError();
		}
		chunks.push(value);
	}

	const bytes = new Uint8Array(byteLength);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes));
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
const CurrentGenerationRunStatusResponseSchema = CurrentGenerationRunProjectionSchema.extend({
	generation_run_id: z.string().min(1),
	workflow: WorkflowObservationSchema,
});

const LegacyGenerationRunStatusResponseSchema = LegacyGenerationRunProjectionSchema.extend({
	generation_run_id: z.string().min(1),
	workflow: WorkflowObservationSchema,
});

export const GenerationRunStatusResponseSchema = z.union([
	CurrentGenerationRunStatusResponseSchema,
	LegacyGenerationRunStatusResponseSchema,
]);

export async function createGenerationRun(request: Request, env: Env): Promise<Response> {
	if (!hasJsonContentType(request)) {
		return jsonResponse(415, { error: "unsupported_media_type" });
	}

	let body: unknown;
	try {
		body = await readGenerationRunBody(request);
	} catch (error) {
		if (error instanceof GenerationRunBodyTooLargeError) {
			return jsonResponse(413, { error: "request_body_too_large" });
		}
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
		console.error("workflow status observation unavailable", {
			name: error instanceof Error ? error.name : "UnknownError",
		});
		workflow = {
			observation: "unavailable",
			error: {
				name: "WorkflowObservationUnavailable",
				message: "Workflow status is unavailable",
			},
		};
	}
	const response = GenerationRunStatusResponseSchema.parse({
		...projection,
		generation_run_id: generationRunId,
		workflow,
	});
	return jsonResponse(200, response);
}

export async function getPublishedEdition(
	params: z.infer<typeof GenerationRunParamsSchema>,
	env: Env,
): Promise<Response> {
	const { active_region_id, publication_date } = params;
	let edition;
	try {
		edition = await readEdition(env.DB, active_region_id, publication_date);
	} catch (error) {
		if (error instanceof EditionUnreadableError) {
			return jsonResponse(500, { error: "edition_unreadable" }, { "Cache-Control": "no-store" });
		}
		throw error;
	}
	if (edition === undefined) {
		return jsonResponse(404, { error: "edition_not_found" }, { "Cache-Control": "no-store" });
	}
	return jsonResponse(200, edition);
}
