import {
	GENERATION_STEPS,
	type WalkEditorialDiagnostic,
	type WalkGenerationRunStatus,
} from "./generation-run-status";

export const RECORDED_PRODUCTION_STEPS = [
	"main_story_write",
	"main_story_copyedit",
	"announcements_write",
	"announcements_copyedit",
] as const;

export type RecordedProductionStep = (typeof RECORDED_PRODUCTION_STEPS)[number];

export interface RecordedResponse {
	production_step: RecordedProductionStep;
	provider: string;
	model: string;
	prompt_sha256: string;
	text: string;
}

export const RECORDED_GENERATION_DIAGNOSTICS = [
	{
		kind: "preservation",
		production_step: "main_story_copyedit",
		code: "quoted_span",
		message: "Copyedit changed quoted spans or their order in main_story.body",
	},
	{
		kind: "preservation",
		production_step: "main_story_copyedit",
		code: "numeric_literal",
		message: "Copyedit changed numeric literals or their order in main_story.body",
	},
	{
		kind: "final_product",
		production_step: "main_story_copyedit",
		code: "forbidden_marker",
		message: "Forbidden output marker: —",
	},
	{
		kind: "final_product",
		production_step: "main_story_copyedit",
		code: "ungrounded_quote",
		message: "Ungrounded quote: damn R8 is doing T7 dungeons atm",
	},
] as const satisfies readonly WalkEditorialDiagnostic[];

export function assertCompletedRecordedGenerationStatus(
	status: WalkGenerationRunStatus,
	recordedResponses: readonly RecordedResponse[],
): void {
	if (status.state !== "complete" || status.current_step !== null || status.failure !== null) {
		throw new Error(
			`complete generation run retained an incomplete state, current step, or failure: ${JSON.stringify(status)}`,
		);
	}
	if (JSON.stringify(status.completed_steps) !== JSON.stringify(GENERATION_STEPS)) {
		throw new Error(`completed generation steps are not exact and ordered: ${JSON.stringify(status)}`);
	}
	if (
		status.model_usage.length !== RECORDED_PRODUCTION_STEPS.length ||
		status.model_usage.some(
			(record, index) =>
				record.production_step !== RECORDED_PRODUCTION_STEPS[index] ||
				record.provider !== recordedResponses[index]?.provider ||
				record.model !== recordedResponses[index]?.model ||
				record.execution !== "recorded_replay" ||
				record.token_usage.measurement !== "unavailable" ||
				record.external_billing.classification !== "none" ||
				record.external_billing.amount_usd !== 0 ||
				record.external_billing.reason !== "recorded_replay",
		)
	) {
		throw new Error(`model usage does not prove four ordered recorded replays at zero external billing: ${JSON.stringify(status)}`);
	}
	if (JSON.stringify(status.diagnostics) !== JSON.stringify(RECORDED_GENERATION_DIAGNOSTICS)) {
		throw new Error(`editorial diagnostics do not match the exact recorded evidence: ${JSON.stringify(status)}`);
	}
	if (status.workflow.observation !== "available" || status.workflow.status !== "complete") {
		throw new Error(`Workflow observation is not available/complete: ${JSON.stringify(status.workflow)}`);
	}
}
