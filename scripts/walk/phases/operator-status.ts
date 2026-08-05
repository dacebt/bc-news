import type { WalkContext, WalkPhase } from "../phase";
import { GENERATION_STEPS, fetchGenerationRunStatus } from "../generation-run-status";
import { POLL_INTERVAL_MS, sleep } from "../timing";

const STATUS_TIMEOUT_MS = 60_000;
const CAPABILITIES = ["main_story", "announcements", "packaging"];

async function run(ctx: WalkContext): Promise<void> {
	const deadline = Date.now() + STATUS_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const status = await fetchGenerationRunStatus(ctx.baseUrl, ctx.pair);
		if (status.state !== "complete") {
			await sleep(POLL_INTERVAL_MS);
			continue;
		}
		if (JSON.stringify(status.completed_steps) !== JSON.stringify(GENERATION_STEPS)) {
			throw new Error(`completed generation steps are not exact and ordered: ${JSON.stringify(status)}`);
		}
		if (
			status.model_usage.length !== CAPABILITIES.length ||
			status.model_usage.some(
				(record, index) =>
					record.editorial_capability !== CAPABILITIES[index] ||
					record.execution !== "recorded_replay" ||
					record.token_usage.measurement !== "unavailable" ||
					record.external_billing.classification !== "none" ||
					record.external_billing.amount_usd !== 0 ||
					record.external_billing.reason !== "recorded_replay",
			)
		) {
			throw new Error(`model usage does not prove three recorded replays at zero external billing: ${JSON.stringify(status)}`);
		}
		if (status.workflow.observation !== "available" || status.workflow.status !== "complete") {
			throw new Error(`Workflow observation is not available/complete: ${JSON.stringify(status.workflow)}`);
		}
		ctx.state.firstModelUsageBody = JSON.stringify(status.model_usage);
		console.log("walk: operator status proved six steps and three zero-external-billing recorded replays");
		return;
	}
	throw new Error(`generation run operator status did not reach complete within ${STATUS_TIMEOUT_MS} ms`);
}

export const walkPhase: WalkPhase = { name: "operator-status", run };
