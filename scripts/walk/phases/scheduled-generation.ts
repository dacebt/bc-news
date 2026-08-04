import { ACTIVE_REGION_IDS } from "@bc-news/contracts";
import type { WalkContext, WalkPhase } from "../phase";
import { dispatchScheduledEvent } from "../scheduled-event";
import { POLL_INTERVAL_MS, sleep } from "../timing";

const FAILURE_TIMEOUT_MS = 60_000;
const NO_EVIDENCE_ERROR_CODE = "no_evidence_for_publication_date";
const INSTANCE_STATUSES = new Set([
	"queued",
	"running",
	"paused",
	"errored",
	"terminated",
	"complete",
	"waiting",
	"waitingForPause",
	"unknown",
]);

interface GenerationRunStatusResponse {
	id: string;
	status: {
		status: string;
		error?: { name: string; message: string; code?: string };
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedWorkflowErrorCode(name: string, message: string): string | undefined {
	if (name === NO_EVIDENCE_ERROR_CODE) {
		return NO_EVIDENCE_ERROR_CODE;
	}
	if (name === "Error" && message.startsWith(`${NO_EVIDENCE_ERROR_CODE}: `)) {
		return NO_EVIDENCE_ERROR_CODE;
	}
	return undefined;
}

export function parseGenerationRunStatusResponse(
	body: string,
	expectedId: string,
): GenerationRunStatusResponse {
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch (error) {
		throw new Error(`generation run status for ${expectedId} is not valid JSON`, { cause: error });
	}
	if (!isRecord(parsed) || parsed["id"] !== expectedId || !isRecord(parsed["status"])) {
		throw new Error(`generation run status for ${expectedId} has an invalid envelope: ${body}`);
	}
	const status = parsed["status"];
	if (typeof status["status"] !== "string" || !INSTANCE_STATUSES.has(status["status"])) {
		throw new Error(`generation run status for ${expectedId} has an invalid nested state: ${body}`);
	}
	let workflowError: { name: string; message: string; code?: string } | undefined;
	if (status["error"] !== undefined) {
		if (
			!isRecord(status["error"]) ||
			typeof status["error"]["name"] !== "string" ||
			typeof status["error"]["message"] !== "string"
		) {
			throw new Error(`generation run status for ${expectedId} has an invalid nested error: ${body}`);
		}
		const name = status["error"]["name"];
		const message = status["error"]["message"];
		const code = normalizedWorkflowErrorCode(name, message);
		workflowError = { name, message, ...(code !== undefined ? { code } : {}) };
	}
	return {
		id: expectedId,
		status: {
			status: status["status"],
			...(workflowError !== undefined ? { error: workflowError } : {}),
		},
	};
}

export function assertExplicitNoEvidenceFailure(
	response: GenerationRunStatusResponse,
): void {
	if (
		response.status.status !== "errored" ||
		response.status.error?.code !== NO_EVIDENCE_ERROR_CODE
	) {
		throw new Error(
			`generation run ${response.id} did not expose nested errored/no_evidence_for_publication_date status: ${JSON.stringify(response)}`,
		);
	}
}

function instanceId(activeRegionId: string, publicationDate: string): string {
	return `generation-run-${activeRegionId}-${publicationDate}`;
}

async function generationRunStatus(
	ctx: WalkContext,
	activeRegionId: string,
): Promise<GenerationRunStatusResponse> {
	const id = instanceId(activeRegionId, ctx.pair.publication_date);
	const response = await fetch(`${ctx.baseUrl}/generation-run/${id}`);
	const body = await response.text();
	if (response.status !== 200) {
		throw new Error(`scheduled generation identity ${id} expected status 200, got ${response.status} ${body}`);
	}
	return parseGenerationRunStatusResponse(body, id);
}

async function run(ctx: WalkContext): Promise<void> {
	const scheduled = await dispatchScheduledEvent(ctx.baseUrl, ctx.generationCron, ctx.scheduledTime);
	if (scheduled.status !== 200) {
		throw new Error(
			`scheduled generation expected 200, got ${scheduled.status} ${scheduled.body}`,
		);
	}

	await Promise.all(ACTIVE_REGION_IDS.map((activeRegionId) => generationRunStatus(ctx, activeRegionId)));
	console.log(
		`walk: scheduled publication created all ${String(ACTIVE_REGION_IDS.length)} authoritative generation identities`,
	);

	const absentRegionId = ACTIVE_REGION_IDS.find((activeRegionId) => activeRegionId !== ctx.pair.active_region_id);
	if (absentRegionId === undefined) {
		throw new Error("authoritative active-region roster has no absent-evidence region for the walk");
	}
	const deadline = Date.now() + FAILURE_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const response = await generationRunStatus(ctx, absentRegionId);
		if (response.status.status === "errored") {
			assertExplicitNoEvidenceFailure(response);
			console.log(
				`walk: absent region ${absentRegionId} failed explicitly while the scheduled region fan-out remained isolated`,
			);
			return;
		}
		await sleep(POLL_INTERVAL_MS);
	}
	throw new Error(`absent region ${absentRegionId} did not reach explicit no-evidence failure`);
}

export const walkPhase: WalkPhase = { name: "scheduled-generation", run };
