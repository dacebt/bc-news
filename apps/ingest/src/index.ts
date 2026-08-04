import { handlePoll } from "./routes";

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);
		if (request.method === "POST" && url.pathname === "/poll") {
			return handlePoll(env);
		}
		return new Response(JSON.stringify({ error: "route_not_found" }), {
			status: 404,
			headers: { "Content-Type": "application/json" },
		});
	},
} satisfies ExportedHandler<Env>;
