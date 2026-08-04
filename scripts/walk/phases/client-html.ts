import type { WalkContext, WalkPhase } from "../phase";

async function run(ctx: WalkContext): Promise<void> {
	const response = await fetch(`${ctx.baseUrl}/`);
	const contentType = response.headers.get("Content-Type") ?? "";
	if (response.status !== 200 || !contentType.includes("text/html")) {
		throw new Error(
			`client HTML expected 200 text/html, got ${response.status} ${contentType}`,
		);
	}
	console.log("walk: client HTML served with 200");
}

export const walkPhase: WalkPhase = { name: "client-html", run };
