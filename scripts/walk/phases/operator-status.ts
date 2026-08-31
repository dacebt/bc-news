import type { WalkContext, WalkPhase } from "../phase";
import { fetchGenerationRunStatus } from "../generation-run-status";
import {
	RECORDED_PRODUCTION_STEPS,
	assertCompletedRecordedGenerationStatus,
	recordedGenerationEvidence,
} from "../recorded-response";
import { readRecordedResponse } from "../recorded-response-reader";
import { POLL_INTERVAL_MS, sleep } from "../timing";

const STATUS_TIMEOUT_MS = 60_000;

async function run(ctx: WalkContext): Promise<void> {
	const recordedResponses = await Promise.all(
		RECORDED_PRODUCTION_STEPS.map((productionStep) => readRecordedResponse(productionStep)),
	);
	const deadline = Date.now() + STATUS_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const status = await fetchGenerationRunStatus(ctx.baseUrl, ctx.pair, ctx.operatorToken);
		if (status.state !== "complete") {
			await sleep(POLL_INTERVAL_MS);
			continue;
		}
		assertCompletedRecordedGenerationStatus(status, recordedResponses);
		ctx.state.firstGenerationRunEvidence = recordedGenerationEvidence(status);
		console.log(
			"walk: operator status proved current_v2 retry history, three distinct recorded provider attempts, two accepted writer usages, and writer-only editorial diagnostics",
		);
		return;
	}
	throw new Error(`generation run operator status did not reach complete within ${STATUS_TIMEOUT_MS} ms`);
}

export const walkPhase: WalkPhase = { name: "operator-status", run };
