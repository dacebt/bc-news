import { createGenerationRun, getGenerationRunStatus, getPublishedEdition } from "./routes";

export { GenerationRun } from "./generation-run";

const GENERATION_RUN_STATUS_PATH = "/generation-run/";

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);
		if (request.method === "POST" && url.pathname === "/generation-run") {
			return createGenerationRun(request, env);
		}
		if (request.method === "GET" && url.pathname.startsWith(GENERATION_RUN_STATUS_PATH)) {
			return getGenerationRunStatus(url.pathname.slice(GENERATION_RUN_STATUS_PATH.length), env);
		}
		if (request.method === "GET" && url.pathname === "/api/edition") {
			return getPublishedEdition(url, env);
		}
		return new Response(JSON.stringify({ error: "route_not_found" }), {
			status: 404,
			headers: { "Content-Type": "application/json" },
		});
	},
} satisfies ExportedHandler<Env>;
