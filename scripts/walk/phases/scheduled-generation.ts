import { ACTIVE_REGION_IDS } from "@bc-news/contracts";
import type { WalkContext, WalkPhase } from "../phase";
import { dispatchScheduledEvent } from "../scheduled-event";
import { fetchGenerationRunStatus, type WalkGenerationRunStatus } from "../generation-run-status";
import { POLL_INTERVAL_MS, sleep } from "../timing";

const FAILURE_TIMEOUT_MS = 60_000;

export function assertExplicitNoEvidenceFailure(response: WalkGenerationRunStatus): void {
	if (
		response.state !== "errored" ||
		response.failure?.step !== "prepare-evidence" ||
		response.failure.code !== "no_evidence_for_publication_date" ||
		response.model_usage.length !== 0
	) {
		throw new Error(
			`generation run ${response.generation_run_id} did not expose prepare-evidence/no-evidence failure with empty usage: ${JSON.stringify(response)}`,
		);
	}
}

async function run(ctx: WalkContext): Promise<void> {
	const scheduled = await dispatchScheduledEvent(ctx.baseUrl, ctx.generationCron, ctx.scheduledTime);
	if (scheduled.status !== 200) {
		throw new Error(
			`scheduled generation expected 200, got ${scheduled.status} ${scheduled.body}`,
		);
	}

	await Promise.all(
		ACTIVE_REGION_IDS.map((activeRegionId) =>
			fetchGenerationRunStatus(
				ctx.baseUrl,
				{
					active_region_id: activeRegionId,
					publication_date: ctx.pair.publication_date,
				},
				ctx.operatorToken,
			),
		),
	);
	console.log(
		`walk: scheduled publication created all ${String(ACTIVE_REGION_IDS.length)} authoritative generation identities`,
	);

	const absentRegionId = ACTIVE_REGION_IDS.find((activeRegionId) => activeRegionId !== ctx.pair.active_region_id);
	if (absentRegionId === undefined) {
		throw new Error("authoritative active-region roster has no absent-evidence region for the walk");
	}
	const absentPair = {
		active_region_id: absentRegionId,
		publication_date: ctx.pair.publication_date,
	};
	const deadline = Date.now() + FAILURE_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const response = await fetchGenerationRunStatus(ctx.baseUrl, absentPair, ctx.operatorToken);
		if (response.state === "errored") {
			assertExplicitNoEvidenceFailure(response);
			console.log(
				`walk: absent region ${absentRegionId} failed explicitly with no model usage while sibling runs remained isolated`,
			);
			return;
		}
		await sleep(POLL_INTERVAL_MS);
	}
	throw new Error(`absent region ${absentRegionId} did not reach explicit no-evidence failure`);
}

export const walkPhase: WalkPhase = { name: "scheduled-generation", run };
