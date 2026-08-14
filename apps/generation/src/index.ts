import {
	createGenerationRun,
	getGenerationRunStatusByPair,
	getPublishedEdition,
} from "./routes";
import { protectOperatorRoute } from "./operator-http";
import { scheduleGenerationRuns } from "./scheduler";

export { GenerationRun } from "./generation-run";

function routeNotFoundResponse(): Response {
	return new Response(JSON.stringify({ error: "route_not_found" }), {
		status: 404,
		headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
	});
}

export async function dispatchGenerationRequest(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	if (request.method === "POST" && url.pathname === "/generation-run") {
		return protectOperatorRoute(request, env, () => createGenerationRun(request, env));
	}
	if (request.method === "GET" && url.pathname === "/generation-run") {
		return protectOperatorRoute(request, env, () => getGenerationRunStatusByPair(url, env));
	}
	if (request.method === "GET" && url.pathname === "/api/edition") {
		return getPublishedEdition(url, env);
	}
	return routeNotFoundResponse();
}

export default {
	async fetch(request, env): Promise<Response> {
		return dispatchGenerationRequest(request, env);
	},
	async scheduled(controller, env): Promise<void> {
		await scheduleGenerationRuns(controller.scheduledTime, env);
	},
} satisfies ExportedHandler<Env>;
