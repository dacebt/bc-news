import type { GenerationRunParams } from "@bc-news/contracts";

export const CURRENT_V1_GENERATION_RUN_CONTRACT_VERSION = "current_v1";
export const CURRENT_V2_GENERATION_RUN_CONTRACT_VERSION = "current_v2";

export const GENERATION_STEPS = [
	"prepare-evidence",
	"main_story_write",
	"announcements_write",
	"validate-edition",
	"publish-edition",
] as const;

export const WRITER_STEPS = [
	"main_story_write",
	"announcements_write",
] as const;

export const STATUS_METADATA_KEYS = ["created_at_utc", "updated_at_utc"] as const;

export const LEGACY_GENERATION_STEPS = [
	"prepare-evidence",
	"main_story_write",
	"main_story_copyedit",
	"announcements_write",
	"announcements_copyedit",
	"validate-edition",
	"publish-edition",
] as const;

export type CurrentV1WalkGenerationStep = (typeof GENERATION_STEPS)[number];
export type CurrentV2WalkGenerationStep = CurrentV1WalkGenerationStep;
export type LegacyWalkGenerationStep = (typeof LEGACY_GENERATION_STEPS)[number];
export type WalkProductionStep = (typeof WRITER_STEPS)[number];
export type LegacyWalkProductionStep =
	| "main_story_write"
	| "main_story_copyedit"
	| "announcements_write"
	| "announcements_copyedit";
export type WalkWriterStep = WalkProductionStep;
export type WalkMechanicalRejectionCode = "invalid_json" | "contract_mismatch";
export type LegacyWalkCopyeditStep = "main_story_copyedit" | "announcements_copyedit";
export type WalkPreservationDiagnosticCode =
	| "announcement_count"
	| "announcement_identity"
	| "field_shape"
	| "paragraph_count"
	| "quoted_span"
	| "numeric_literal"
	| "protected_markdown"
	| "protected_value";
export type WalkFinalProductDiagnosticCode =
	| "forbidden_marker"
	| "ungrounded_marked_name"
	| "ungrounded_quote";
export type WalkExecution = "recorded_replay" | "local_inference" | "hosted_inference";
export type WalkTokenUsage =
	| {
			measurement: "reported";
			input_tokens: number;
			output_tokens: number;
			total_tokens: number;
	  }
	| { measurement: "unavailable" };
export type WalkExternalBilling =
	| { classification: "none"; amount_usd: 0; reason: "recorded_replay" | "local_inference" }
	| { classification: "provider_reported"; amount_usd: number }
	| { classification: "calculated"; amount_usd: number; pricing_reference: string }
	| { classification: "unavailable"; reason: "provider_did_not_report_cost" };
export type WalkWorkflowStatus =
	| "queued"
	| "running"
	| "paused"
	| "errored"
	| "terminated"
	| "complete"
	| "waiting"
	| "waitingForPause"
	| "unknown";
export type WalkGenerationState = "queued" | "running" | "complete" | "errored";
export type WalkWorkflow =
	| { observation: "available"; status: WalkWorkflowStatus; error: { name: string; message: string } | null }
	| { observation: "unavailable"; error: { name: string; message: string } };

export interface WalkRequestCorrelation {
	run_id: string;
	invocation_id: string;
}

export type WalkGatewayLogId =
	| string
	| { state: "unavailable"; reason: "provider_did_not_report" };

export type WalkRequestProvenance =
	| {
			transport: "cloudflare_ai_gateway_rest";
			account_id: string;
			gateway: { selection: "named"; id: string } | { selection: "account_default" };
			gateway_log_id: WalkGatewayLogId;
			requested_model: string;
			correlation: WalkRequestCorrelation;
			policy: {
				cache: "bypass";
				log_metadata: true;
				log_payload: false;
				max_attempts: 1;
				request_timeout_ms: number;
				request_format?: "chat_completions" | "responses";
				response_delivery?: "buffered" | "streaming";
				structured_output?: {
					format: "openai_chat_json_schema" | "openai_responses_json_schema";
					contract_name: string;
				};
			};
	  };

export interface WalkModelUsageRecord {
	production_step: WalkProductionStep;
	provider: string;
	model: string;
	execution: WalkExecution;
	token_usage: WalkTokenUsage;
	external_billing: WalkExternalBilling;
	request_provenance?: WalkRequestProvenance;
}

export interface LegacyWalkModelUsageRecord {
	production_step: LegacyWalkProductionStep;
	provider: string;
	model: string;
	execution: WalkExecution;
	token_usage: WalkTokenUsage;
	external_billing: WalkExternalBilling;
	request_provenance?: WalkRequestProvenance;
}

export interface WalkModelAttemptUsageRecord {
	production_step: WalkProductionStep;
	provider: string;
	model: string;
	execution: WalkExecution;
	token_usage: WalkTokenUsage;
	external_billing: WalkExternalBilling;
	request_provenance?: WalkRequestProvenance;
}

export type WalkCurrentEditorialDiagnostic = {
	kind: "final_product";
	production_step: WalkWriterStep;
	code: WalkFinalProductDiagnosticCode;
	message: string;
};

export type WalkLegacyEditorialDiagnostic =
	| {
			kind: "preservation";
			production_step: LegacyWalkCopyeditStep;
			code: WalkPreservationDiagnosticCode;
			message: string;
	  }
	| {
			kind: "final_product";
			production_step: LegacyWalkCopyeditStep;
			code: WalkFinalProductDiagnosticCode;
			message: string;
	  };

export type WalkEditorialDiagnostic =
	| WalkCurrentEditorialDiagnostic
	| WalkLegacyEditorialDiagnostic;

export type WalkModelAttemptOutcome =
	| { status: "accepted" }
	| { status: "rejected"; code: WalkMechanicalRejectionCode; message: string };

export interface WalkModelAttemptRecord {
	production_step: WalkProductionStep;
	attempt: 1 | 2;
	invocation_id: string;
	outcome: WalkModelAttemptOutcome;
	model_usage: WalkModelAttemptUsageRecord;
}

export type WalkFailure<Step extends string> = {
	step: Step | "configure-generation-run" | "launch-generation-run";
	code: string;
	message: string;
};

export interface WalkGenerationRunStatusBase<
	Step extends string,
	ModelUsage extends { production_step: string },
	Diagnostic extends { production_step: string },
> {
	active_region_id: string;
	publication_date: string;
	generation_run_id: string;
	state: WalkGenerationState;
	current_step: Step | null;
	completed_steps: readonly Step[];
	model_usage: readonly ModelUsage[];
	diagnostics: readonly Diagnostic[];
	failure: WalkFailure<Step> | null;
	workflow: WalkWorkflow;
}

export interface CurrentV1WalkGenerationRunStatus
	extends WalkGenerationRunStatusBase<
		CurrentV1WalkGenerationStep,
		WalkModelUsageRecord,
		WalkCurrentEditorialDiagnostic
	> {
	contract_version: typeof CURRENT_V1_GENERATION_RUN_CONTRACT_VERSION;
}

export interface CurrentV2WalkGenerationRunStatus
	extends WalkGenerationRunStatusBase<
		CurrentV2WalkGenerationStep,
		WalkModelUsageRecord,
		WalkCurrentEditorialDiagnostic
	> {
	contract_version: typeof CURRENT_V2_GENERATION_RUN_CONTRACT_VERSION;
	model_attempts: readonly WalkModelAttemptRecord[];
}

export type LegacyWalkGenerationRunStatus = WalkGenerationRunStatusBase<
	LegacyWalkGenerationStep,
	LegacyWalkModelUsageRecord,
	WalkLegacyEditorialDiagnostic
>;

export type WalkGenerationRunStatus =
	| CurrentV1WalkGenerationRunStatus
	| CurrentV2WalkGenerationRunStatus
	| LegacyWalkGenerationRunStatus;

export interface GenerationRunStatusHttpResponse {
	status: number;
	body: string;
	cacheControl: string | null;
}

export interface ParsedStatusEnvelope {
	active_region_id: string;
	publication_date: string;
	generation_run_id: string;
	state: WalkGenerationState;
	current_step: unknown;
	completed_steps: unknown;
	model_usage: unknown[];
	model_attempts?: unknown[];
	diagnostics: unknown[];
	failure: unknown;
	workflow: unknown;
	contract_version?: unknown;
}

export type WalkGenerationRunPair = GenerationRunParams;
