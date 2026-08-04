import type { WalkContext, WalkPhase } from "../phase";
import { editionUrl } from "../edition-api";

async function run(ctx: WalkContext): Promise<void> {
	const response = await fetch(editionUrl(ctx.baseUrl, ctx.unpublishedPair));
	if (response.status !== 404) {
		throw new Error(`unknown pair expected 404, got ${response.status}`);
	}
	console.log("walk: unknown pair answered 404");
}

export const walkPhase: WalkPhase = { name: "unknown-pair", run };
