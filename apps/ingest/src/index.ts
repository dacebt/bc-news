import { handlePoll } from "./routes";
import { schedulePoll } from "./scheduler";

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
	async scheduled(_controller, env): Promise<void> {
		await schedulePoll(env);
	},
} satisfies ExportedHandler<Env>;
