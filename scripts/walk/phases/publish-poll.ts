import { EditionSchema } from "@bc-news/contracts";
import type { WalkContext, WalkPhase } from "../phase";
import { editionUrl } from "../edition-api";
import { requestGenerationRunStatus } from "../generation-run-status";
import { POLL_INTERVAL_MS, sleep } from "../timing";

const PUBLISH_TIMEOUT_MS = 60_000;

async function printGenerationRunStatus(ctx: WalkContext): Promise<void> {
	try {
		const response = await requestGenerationRunStatus(
			ctx.baseUrl,
			ctx.pair,
			ctx.operatorToken,
		);
		console.error(`walk: generation run status (${response.status}): ${response.body}`);
	} catch (error) {
		console.error(`walk: could not fetch generation run status: ${String(error)}`);
	}
}

async function run(ctx: WalkContext): Promise<void> {
	const url = editionUrl(ctx.baseUrl, ctx.pair);
	const deadline = Date.now() + PUBLISH_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const response = await fetch(url);
		if (response.status === 200) {
			const body = await response.text();
			EditionSchema.parse(JSON.parse(body));
			ctx.state.firstServedEditionBody = body;
			console.log("walk: published edition served and parsed against EditionSchema");
			return;
		}
		if (response.status !== 404) {
			throw new Error(
				`edition read returned ${response.status} while waiting for publish: ${await response.text()}`,
			);
		}
		await sleep(POLL_INTERVAL_MS);
	}
	await printGenerationRunStatus(ctx);
	throw new Error(`edition not published within ${PUBLISH_TIMEOUT_MS} ms`);
}

export const walkPhase: WalkPhase = { name: "publish-poll", run };
