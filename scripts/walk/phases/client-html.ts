import type { WalkContext, WalkPhase } from "../phase";
import { assertSecurityResponseHeaders } from "../security-response-headers";

async function run(ctx: WalkContext): Promise<void> {
	const response = await fetch(`${ctx.baseUrl}/`);
	const contentType = response.headers.get("Content-Type") ?? "";
	if (response.status !== 200 || !contentType.includes("text/html")) {
		throw new Error(
			`client HTML expected 200 text/html, got ${response.status} ${contentType}`,
		);
	}
	assertSecurityResponseHeaders(response, "client HTML");
	console.log("walk: client HTML served with 200 and exact browser-security headers");
}

export const walkPhase: WalkPhase = { name: "client-html", run };
