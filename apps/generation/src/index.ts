import {
	createGenerationRun,
	getGenerationRunStatusByPair,
} from "./routes";
import { withDynamicSecurityHeaders } from "./http-security";
import { protectOperatorRoute } from "./operator-http";
import { servePublicEdition, type EditionResponseCache } from "./public-edition-http";
import { scheduleGenerationRuns } from "./scheduler";

export { GenerationRun } from "./generation-run";

function routeNotFoundResponse(): Response {
	return new Response(JSON.stringify({ error: "route_not_found" }), {
		status: 404,
		headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
	});
}

export async function dispatchGenerationRequest(
	request: Request,
	env: Env,
	context?: Pick<ExecutionContext, "waitUntil">,
	cache: EditionResponseCache = caches.default,
): Promise<Response> {
	const url = new URL(request.url);
	let response: Response;
	if (request.method === "POST" && url.pathname === "/generation-run") {
		response = await protectOperatorRoute(request, env, () => createGenerationRun(request, env));
	} else if (request.method === "GET" && url.pathname === "/generation-run") {
		response = await protectOperatorRoute(request, env, () => getGenerationRunStatusByPair(url, env));
	} else if (request.method === "GET" && url.pathname === "/api/edition") {
		response = await servePublicEdition(request, env, context, cache);
	} else {
		response = routeNotFoundResponse();
	}
	return withDynamicSecurityHeaders(response);
}

export default {
	async fetch(request, env, context): Promise<Response> {
		return dispatchGenerationRequest(request, env, context);
	},
	async scheduled(controller, env): Promise<void> {
		await scheduleGenerationRuns(controller.scheduledTime, env);
	},
} satisfies ExportedHandler<Env>;
