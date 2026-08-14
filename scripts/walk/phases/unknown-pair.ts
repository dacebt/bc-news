import type { WalkContext, WalkPhase } from "../phase";
import { editionUrl } from "../edition-api";
import {
	assertCacheControl,
	assertSecurityResponseHeaders,
	NON_CACHEABLE_RESPONSE_CACHE_CONTROL,
} from "../security-response-headers";

async function run(ctx: WalkContext): Promise<void> {
	const response = await fetch(editionUrl(ctx.baseUrl, ctx.unpublishedPair));
	if (response.status !== 404) {
		throw new Error(`unknown pair expected 404, got ${response.status}`);
	}
	assertSecurityResponseHeaders(response, "unknown edition pair");
	assertCacheControl(response, NON_CACHEABLE_RESPONSE_CACHE_CONTROL, "unknown edition pair");
	console.log("walk: unknown pair answered 404 with exact security and no-store headers");
}

export const walkPhase: WalkPhase = { name: "unknown-pair", run };
