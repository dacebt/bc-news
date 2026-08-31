import type {
	CurrentV1WalkGenerationRunStatus,
	CurrentV2WalkGenerationRunStatus,
	WalkGenerationRunStatus,
	WalkModelAttemptRecord,
	WalkModelUsageRecord,
} from "./generation-run-status";

export const RECORDED_PRODUCTION_STEPS = [
	"main_story_write",
	"announcements_write",
] as const;

export type RecordedProductionStep = (typeof RECORDED_PRODUCTION_STEPS)[number];

export interface RecordedResponse {
	production_step: RecordedProductionStep;
	provider: string;
	model: string;
	prompt_sha256: string;
	text: string;
}

export interface RecordedGenerationEvidence {
	readonly model_usage: WalkGenerationRunStatus["model_usage"];
	readonly model_attempts: readonly WalkModelAttemptRecord[];
	readonly diagnostics: WalkGenerationRunStatus["diagnostics"];
}

export const RECORDED_GENERATION_DIAGNOSTICS: WalkGenerationRunStatus["diagnostics"] = [];

export function recordedGenerationEvidence(
	status: WalkGenerationRunStatus,
): RecordedGenerationEvidence {
	return {
		model_usage: status.model_usage,
		model_attempts: "model_attempts" in status ? status.model_attempts : [],
		diagnostics: status.diagnostics,
	};
}

export function assertRecordedGenerationEvidenceUnchanged(
	first: RecordedGenerationEvidence,
	status: WalkGenerationRunStatus,
): void {
	const repeated = recordedGenerationEvidence(status);
	if (JSON.stringify(repeated.model_usage) !== JSON.stringify(first.model_usage)) {
		throw new Error("model usage changed after repeated scheduled generation");
	}
	if (JSON.stringify(repeated.model_attempts) !== JSON.stringify(first.model_attempts)) {
		throw new Error("model attempts changed after repeated scheduled generation");
	}
	if (JSON.stringify(repeated.diagnostics) !== JSON.stringify(first.diagnostics)) {
		throw new Error("editorial diagnostics changed after repeated scheduled generation");
	}
}

const RECORDED_COMPLETED_CURRENT_V1_GENERATION_STEPS = [
	"prepare-evidence",
	"main_story_write",
	"announcements_write",
	"validate-edition",
	"publish-edition",
] as const;

const RECORDED_COMPLETED_CURRENT_V2_GENERATION_STEPS = [
	"prepare-evidence",
	"main_story_write",
	"announcements_write",
	"validate-edition",
	"publish-edition",
] as const;

function assertRecordedReplayUsage(
	record: WalkModelUsageRecord,
	expected: RecordedResponse,
	productionStep: RecordedResponse["production_step"],
): void {
	if (
		record.production_step !== productionStep ||
		record.provider !== expected.provider ||
		record.model !== expected.model ||
		record.execution !== "recorded_replay" ||
		record.token_usage.measurement !== "unavailable" ||
		record.external_billing.classification !== "none" ||
		record.external_billing.amount_usd !== 0 ||
		record.external_billing.reason !== "recorded_replay"
	) {
		throw new Error("recorded replay usage mismatch");
	}
}

function assertRecordedAttempt(
	status: CurrentV2WalkGenerationRunStatus,
	attempt: WalkModelAttemptRecord | undefined,
	input: {
		production_step: RecordedResponse["production_step"];
		attempt: 1 | 2;
		outcome: "accepted" | "rejected";
		code?: "invalid_json" | "contract_mismatch";
		expected: RecordedResponse;
	},
): void {
	if (attempt === undefined) {
		throw new Error(`missing recorded model attempt ${input.production_step}/${String(input.attempt)}`);
	}
	if (
		attempt.production_step !== input.production_step ||
		attempt.attempt !== input.attempt ||
		attempt.invocation_id !==
			`${status.generation_run_id}-${input.production_step}-attempt-${String(input.attempt)}`
	) {
		throw new Error(`recorded model attempt identity mismatch: ${JSON.stringify(attempt)}`);
	}
	if (input.outcome === "accepted") {
		if (attempt.outcome.status !== "accepted") {
			throw new Error(`recorded model attempt should be accepted: ${JSON.stringify(attempt)}`);
		}
	} else if (
		attempt.outcome.status !== "rejected" ||
		attempt.outcome.code !== input.code ||
		attempt.outcome.message.trim().length === 0
	) {
		throw new Error(`recorded model attempt should be rejected: ${JSON.stringify(attempt)}`);
	}
	assertRecordedReplayUsage(
		attempt.model_usage,
		input.expected,
		input.production_step,
	);
}

function assertCompletedRecordedGenerationCore(
	status: CurrentV1WalkGenerationRunStatus | CurrentV2WalkGenerationRunStatus,
	recordedResponses: readonly RecordedResponse[],
	expectedCompletedSteps: readonly string[],
): void {
	if (status.state !== "complete" || status.current_step !== null || status.failure !== null) {
		throw new Error(
			`complete generation run retained an incomplete state, current step, or failure: ${JSON.stringify(status)}`,
		);
	}
	if (JSON.stringify(status.completed_steps) !== JSON.stringify(expectedCompletedSteps)) {
		throw new Error(`completed generation steps are not exact and ordered: ${JSON.stringify(status)}`);
	}
	if (status.model_usage.length !== RECORDED_PRODUCTION_STEPS.length) {
		throw new Error(
			`model usage does not prove two accepted recorded writer replays: ${JSON.stringify(status)}`,
		);
	}
	status.model_usage.forEach((record, index) => {
		try {
			assertRecordedReplayUsage(
				record,
				recordedResponses[index]!,
				RECORDED_PRODUCTION_STEPS[index]!,
			);
		} catch {
			throw new Error(
				`model usage does not prove two accepted recorded writer replays: ${JSON.stringify(status)}`,
			);
		}
	});
	if (JSON.stringify(status.diagnostics) !== JSON.stringify(RECORDED_GENERATION_DIAGNOSTICS)) {
		throw new Error(`editorial diagnostics do not match the exact recorded evidence: ${JSON.stringify(status)}`);
	}
	if (status.workflow.observation !== "available" || status.workflow.status !== "complete") {
		throw new Error(`Workflow observation is not available/complete: ${JSON.stringify(status.workflow)}`);
	}
}

function assertCompletedCurrentV1RecordedGenerationStatus(
	status: CurrentV1WalkGenerationRunStatus,
	recordedResponses: readonly RecordedResponse[],
): void {
	assertCompletedRecordedGenerationCore(
		status,
		recordedResponses,
		RECORDED_COMPLETED_CURRENT_V1_GENERATION_STEPS,
	);
}

function assertCompletedCurrentV2RecordedGenerationStatus(
	status: CurrentV2WalkGenerationRunStatus,
	recordedResponses: readonly RecordedResponse[],
): void {
	assertCompletedRecordedGenerationCore(
		status,
		recordedResponses,
		RECORDED_COMPLETED_CURRENT_V2_GENERATION_STEPS,
	);
	if (status.model_attempts.length !== 3) {
		throw new Error(`model attempts did not retain the exact retry history: ${JSON.stringify(status)}`);
	}
	assertRecordedAttempt(status, status.model_attempts[0], {
		production_step: "main_story_write",
		attempt: 1,
		outcome: "rejected",
		code: "invalid_json",
		expected: recordedResponses[0]!,
	});
	assertRecordedAttempt(status, status.model_attempts[1], {
		production_step: "main_story_write",
		attempt: 2,
		outcome: "accepted",
		expected: recordedResponses[0]!,
	});
	assertRecordedAttempt(status, status.model_attempts[2], {
		production_step: "announcements_write",
		attempt: 1,
		outcome: "accepted",
		expected: recordedResponses[1]!,
	});
}

function isCurrentV1RecordedGenerationStatus(
	status: WalkGenerationRunStatus,
): status is CurrentV1WalkGenerationRunStatus {
	return "contract_version" in status && status.contract_version === "current_v1";
}

function isCurrentV2RecordedGenerationStatus(
	status: WalkGenerationRunStatus,
): status is CurrentV2WalkGenerationRunStatus {
	return "contract_version" in status && status.contract_version === "current_v2";
}

export function assertCompletedRecordedGenerationStatus(
	status: WalkGenerationRunStatus,
	recordedResponses: readonly RecordedResponse[],
): void {
	if (isCurrentV1RecordedGenerationStatus(status)) {
		assertCompletedCurrentV1RecordedGenerationStatus(status, recordedResponses);
		return;
	}
	if (isCurrentV2RecordedGenerationStatus(status)) {
		assertCompletedCurrentV2RecordedGenerationStatus(status, recordedResponses);
		return;
	}
	throw new Error(
		`recorded walk expected current_v1 or current_v2 status: ${JSON.stringify(status)}`,
	);
}
