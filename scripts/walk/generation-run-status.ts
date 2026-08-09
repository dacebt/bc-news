import type { GenerationRunParams } from "@bc-news/contracts";

export const GENERATION_STEPS = [
	"prepare-evidence",
	"main_story_write",
	"main_story_copyedit",
	"announcements_write",
	"announcements_copyedit",
	"validate-edition",
	"publish-edition",
] as const;

type WalkGenerationStep = (typeof GENERATION_STEPS)[number];
type WalkProductionStep =
	| "main_story_write"
	| "main_story_copyedit"
	| "announcements_write"
	| "announcements_copyedit";
type WalkCopyeditStep = "main_story_copyedit" | "announcements_copyedit";
type WalkPreservationDiagnosticCode =
	| "announcement_count"
	| "announcement_identity"
	| "field_shape"
	| "paragraph_count"
	| "quoted_span"
	| "numeric_literal"
	| "protected_markdown"
	| "protected_value";
type WalkFinalProductDiagnosticCode =
	| "forbidden_marker"
	| "ungrounded_marked_name"
	| "ungrounded_quote";
type WalkExecution = "recorded_replay" | "local_inference" | "hosted_inference";
type WalkTokenUsage =
	| {
			measurement: "reported";
			input_tokens: number;
			output_tokens: number;
			total_tokens: number;
	  }
	| { measurement: "unavailable" };
type WalkExternalBilling =
	| { classification: "none"; amount_usd: 0; reason: "recorded_replay" | "local_inference" }
	| { classification: "provider_reported"; amount_usd: number }
	| { classification: "calculated"; amount_usd: number; pricing_reference: string }
	| { classification: "unavailable"; reason: "provider_did_not_report_cost" };
type WalkWorkflowStatus =
	| "queued"
	| "running"
	| "paused"
	| "errored"
	| "terminated"
	| "complete"
	| "waiting"
	| "waitingForPause"
	| "unknown";

export interface WalkModelUsageRecord {
	production_step: WalkProductionStep;
	provider: string;
	model: string;
	execution: WalkExecution;
	token_usage: WalkTokenUsage;
	external_billing: WalkExternalBilling;
}

export type WalkEditorialDiagnostic =
	| {
			kind: "preservation";
			production_step: WalkCopyeditStep;
			code: WalkPreservationDiagnosticCode;
			message: string;
	  }
	| {
			kind: "final_product";
			production_step: WalkCopyeditStep;
			code: WalkFinalProductDiagnosticCode;
			message: string;
	  };

export interface WalkGenerationRunStatus {
	active_region_id: string;
	publication_date: string;
	generation_run_id: string;
	state: "queued" | "running" | "complete" | "errored";
	current_step: WalkGenerationStep | null;
	completed_steps: WalkGenerationStep[];
	model_usage: WalkModelUsageRecord[];
	diagnostics: WalkEditorialDiagnostic[];
	failure: {
		step: WalkGenerationStep | "configure-generation-run" | "launch-generation-run";
		code: string;
		message: string;
	} | null;
	workflow:
		| { observation: "available"; status: WalkWorkflowStatus; error: { name: string; message: string } | null }
		| { observation: "unavailable"; error: { name: string; message: string } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	return (
		Object.keys(value).length === keys.length &&
		keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
	);
}

function isGenerationStep(value: unknown): value is WalkGenerationStep {
	return GENERATION_STEPS.some((step) => step === value);
}

function isProductionStep(value: unknown): value is WalkProductionStep {
	return (
		value === "main_story_write" ||
		value === "main_story_copyedit" ||
		value === "announcements_write" ||
		value === "announcements_copyedit"
	);
}

function isCopyeditStep(value: unknown): value is WalkCopyeditStep {
	return value === "main_story_copyedit" || value === "announcements_copyedit";
}

function isPreservationDiagnosticCode(value: unknown): value is WalkPreservationDiagnosticCode {
	return (
		value === "announcement_count" ||
		value === "announcement_identity" ||
		value === "field_shape" ||
		value === "paragraph_count" ||
		value === "quoted_span" ||
		value === "numeric_literal" ||
		value === "protected_markdown" ||
		value === "protected_value"
	);
}

function isFinalProductDiagnosticCode(value: unknown): value is WalkFinalProductDiagnosticCode {
	return (
		value === "forbidden_marker" ||
		value === "ungrounded_marked_name" ||
		value === "ungrounded_quote"
	);
}

function parseEditorialDiagnostic(value: unknown, body: string): WalkEditorialDiagnostic {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ["kind", "production_step", "code", "message"]) ||
		!isCopyeditStep(value["production_step"]) ||
		typeof value["message"] !== "string" ||
		value["message"].length === 0
	) {
		throw new Error(`generation run operator status has an invalid diagnostic: ${body}`);
	}
	if (value["kind"] === "preservation" && isPreservationDiagnosticCode(value["code"])) {
		return {
			kind: "preservation",
			production_step: value["production_step"],
			code: value["code"],
			message: value["message"],
		};
	}
	if (value["kind"] === "final_product" && isFinalProductDiagnosticCode(value["code"])) {
		return {
			kind: "final_product",
			production_step: value["production_step"],
			code: value["code"],
			message: value["message"],
		};
	}
	throw new Error(`generation run operator status has an invalid diagnostic: ${body}`);
}

function parseDiagnostics(value: unknown, body: string): WalkEditorialDiagnostic[] {
	if (!Array.isArray(value)) {
		throw new Error(`generation run operator status has invalid diagnostics: ${body}`);
	}
	return value.map((diagnostic) => parseEditorialDiagnostic(diagnostic, body));
}

function isExecution(value: unknown): value is WalkExecution {
	return value === "recorded_replay" || value === "local_inference" || value === "hosted_inference";
}

function isNonnegativeFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function parseTokenUsage(value: unknown, body: string): WalkTokenUsage {
	if (!isRecord(value) || typeof value["measurement"] !== "string") {
		throw new Error(`generation run operator status has invalid token usage: ${body}`);
	}
	if (value["measurement"] === "unavailable" && hasExactKeys(value, ["measurement"])) {
		return { measurement: "unavailable" };
	}
	const inputTokens = value["input_tokens"];
	const outputTokens = value["output_tokens"];
	const totalTokens = value["total_tokens"];
	if (
		value["measurement"] !== "reported" ||
		!hasExactKeys(value, ["measurement", "input_tokens", "output_tokens", "total_tokens"]) ||
		!isNonnegativeFiniteNumber(inputTokens) ||
		!Number.isInteger(inputTokens) ||
		!isNonnegativeFiniteNumber(outputTokens) ||
		!Number.isInteger(outputTokens) ||
		!isNonnegativeFiniteNumber(totalTokens) ||
		!Number.isInteger(totalTokens) ||
		totalTokens !== inputTokens + outputTokens
	) {
		throw new Error(`generation run operator status has invalid token usage: ${body}`);
	}
	return {
		measurement: "reported",
		input_tokens: inputTokens,
		output_tokens: outputTokens,
		total_tokens: totalTokens,
	};
}

function parseExternalBilling(value: unknown, body: string): WalkExternalBilling {
	if (!isRecord(value)) {
		throw new Error(`generation run operator status has invalid external billing: ${body}`);
	}
	if (
		value["classification"] === "none" &&
		hasExactKeys(value, ["classification", "amount_usd", "reason"]) &&
		value["amount_usd"] === 0 &&
		(value["reason"] === "recorded_replay" || value["reason"] === "local_inference")
	) {
		return { classification: "none", amount_usd: 0, reason: value["reason"] };
	}
	if (
		value["classification"] === "provider_reported" &&
		hasExactKeys(value, ["classification", "amount_usd"]) &&
		isNonnegativeFiniteNumber(value["amount_usd"])
	) {
		return { classification: "provider_reported", amount_usd: value["amount_usd"] };
	}
	if (
		value["classification"] === "calculated" &&
		hasExactKeys(value, ["classification", "amount_usd", "pricing_reference"]) &&
		isNonnegativeFiniteNumber(value["amount_usd"]) &&
		typeof value["pricing_reference"] === "string" &&
		value["pricing_reference"].trim().length > 0
	) {
		return {
			classification: "calculated",
			amount_usd: value["amount_usd"],
			pricing_reference: value["pricing_reference"],
		};
	}
	if (
		value["classification"] === "unavailable" &&
		hasExactKeys(value, ["classification", "reason"]) &&
		value["reason"] === "provider_did_not_report_cost"
	) {
		return { classification: "unavailable", reason: "provider_did_not_report_cost" };
	}
	throw new Error(`generation run operator status has invalid external billing: ${body}`);
}

function parseModelUsage(value: unknown, body: string): WalkModelUsageRecord {
	if (!isRecord(value) || !hasExactKeys(value, [
		"production_step",
		"provider",
		"model",
		"execution",
		"token_usage",
		"external_billing",
	])) {
		throw new Error(`generation run operator status has invalid model usage: ${body}`);
	}
	const productionStep = value["production_step"];
	const provider = value["provider"];
	const model = value["model"];
	const execution = value["execution"];
	if (
		!isProductionStep(productionStep) ||
		typeof provider !== "string" ||
		provider.trim().length === 0 ||
		typeof model !== "string" ||
		model.trim().length === 0 ||
		!isExecution(execution)
	) {
		throw new Error(`generation run operator status has invalid model usage: ${body}`);
	}
	return {
		production_step: productionStep,
		provider,
		model,
		execution,
		token_usage: parseTokenUsage(value["token_usage"], body),
		external_billing: parseExternalBilling(value["external_billing"], body),
	};
}

function parseErrorShape(value: unknown, body: string): { name: string; message: string } {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ["name", "message"]) ||
		typeof value["name"] !== "string" ||
		typeof value["message"] !== "string"
	) {
		throw new Error(`generation run operator status has invalid workflow error: ${body}`);
	}
	return { name: value["name"], message: value["message"] };
}

function isWorkflowStatus(value: unknown): value is WalkWorkflowStatus {
	return (
		value === "queued" ||
		value === "running" ||
		value === "paused" ||
		value === "errored" ||
		value === "terminated" ||
		value === "complete" ||
		value === "waiting" ||
		value === "waitingForPause" ||
		value === "unknown"
	);
}

function parseWorkflow(value: unknown, body: string): WalkGenerationRunStatus["workflow"] {
	if (!isRecord(value)) {
		throw new Error(`generation run operator status has invalid workflow: ${body}`);
	}
	if (
		value["observation"] === "available" &&
		hasExactKeys(value, ["observation", "status", "error"]) &&
		isWorkflowStatus(value["status"])
	) {
		return {
			observation: "available",
			status: value["status"],
			error: value["error"] === null ? null : parseErrorShape(value["error"], body),
		};
	}
	if (value["observation"] === "unavailable" && hasExactKeys(value, ["observation", "error"])) {
		return {
			observation: "unavailable",
			error: parseErrorShape(value["error"], body),
		};
	}
	throw new Error(`generation run operator status has invalid workflow: ${body}`);
}

function isGenerationState(value: unknown): value is WalkGenerationRunStatus["state"] {
	return value === "queued" || value === "running" || value === "complete" || value === "errored";
}

function parseCompletedSteps(value: unknown, body: string): WalkGenerationStep[] {
	if (!Array.isArray(value)) {
		throw new Error(`generation run operator status has invalid completed steps: ${body}`);
	}
	const completedSteps: WalkGenerationStep[] = [];
	for (const step of value) {
		if (!isGenerationStep(step)) {
			throw new Error(`generation run operator status has invalid completed steps: ${body}`);
		}
		completedSteps.push(step);
	}
	return completedSteps;
}

function parseFailure(value: unknown, body: string): WalkGenerationRunStatus["failure"] {
	if (value === null) return null;
	if (!isRecord(value) || !hasExactKeys(value, ["step", "code", "message"])) {
		throw new Error(`generation run operator status has invalid failure: ${body}`);
	}
	const step = value["step"];
	const code = value["code"];
	const message = value["message"];
	if (
		!(isGenerationStep(step) || step === "configure-generation-run" || step === "launch-generation-run") ||
		typeof code !== "string" ||
		code.length === 0 ||
		typeof message !== "string" ||
		message.length === 0
	) {
		throw new Error(`generation run operator status has invalid failure: ${body}`);
	}
	return { step, code, message };
}

function assertProjectionCoherence(status: WalkGenerationRunStatus, body: string): void {
	if ((status.state === "running") !== (status.current_step !== null)) {
		throw new Error(`generation run operator status has incoherent current step: ${body}`);
	}
	if ((status.state === "errored") !== (status.failure !== null)) {
		throw new Error(`generation run operator status has incoherent failure: ${body}`);
	}
	if (status.completed_steps.some((step, index) => step !== GENERATION_STEPS[index])) {
		throw new Error(`generation run operator status has unordered completed steps: ${body}`);
	}
	if (
		status.state === "running" &&
		status.current_step !== GENERATION_STEPS[status.completed_steps.length]
	) {
		throw new Error(`generation run operator status has incoherent running step: ${body}`);
	}
	if (status.state === "complete" && status.completed_steps.length !== GENERATION_STEPS.length) {
		throw new Error(`generation run operator status has incomplete completed steps: ${body}`);
	}
	const expectedProductionSteps = status.completed_steps.filter(isProductionStep);
	if (
		status.model_usage.length !== expectedProductionSteps.length ||
		status.model_usage.some(
			(record, index) => record.production_step !== expectedProductionSteps[index],
		)
	) {
		throw new Error(`generation run operator status has incoherent model usage: ${body}`);
	}
	let previousDiagnosticStep = -1;
	for (const diagnostic of status.diagnostics) {
		const stepIndex = expectedProductionSteps.indexOf(diagnostic.production_step);
		if (stepIndex === -1 || stepIndex < previousDiagnosticStep) {
			throw new Error(`generation run operator status has incoherent diagnostics: ${body}`);
		}
		previousDiagnosticStep = stepIndex;
	}
}

export function generationRunStatusUrl(baseUrl: string, pair: GenerationRunParams): string {
	const query = new URLSearchParams(pair);
	return `${baseUrl}/generation-run?${query.toString()}`;
}

export function parseGenerationRunStatusResponse(
	body: string,
	expectedPair: GenerationRunParams,
): WalkGenerationRunStatus {
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch (error) {
		throw new Error("generation run operator status is not valid JSON", { cause: error });
	}
	if (
		!isRecord(parsed) ||
		parsed["active_region_id"] !== expectedPair.active_region_id ||
		parsed["publication_date"] !== expectedPair.publication_date ||
		parsed["generation_run_id"] !== `generation-run-${expectedPair.active_region_id}-${expectedPair.publication_date}` ||
		!isGenerationState(parsed["state"]) ||
		!(parsed["current_step"] === null || isGenerationStep(parsed["current_step"])) ||
		!Array.isArray(parsed["model_usage"]) ||
		!Array.isArray(parsed["diagnostics"])
	) {
		throw new Error(`generation run operator status has an invalid envelope: ${body}`);
	}
	const status: WalkGenerationRunStatus = {
		active_region_id: expectedPair.active_region_id,
		publication_date: expectedPair.publication_date,
		generation_run_id: `generation-run-${expectedPair.active_region_id}-${expectedPair.publication_date}`,
		state: parsed["state"],
		current_step: parsed["current_step"],
		completed_steps: parseCompletedSteps(parsed["completed_steps"], body),
		model_usage: parsed["model_usage"].map((record) => parseModelUsage(record, body)),
		diagnostics: parseDiagnostics(parsed["diagnostics"], body),
		failure: parseFailure(parsed["failure"], body),
		workflow: parseWorkflow(parsed["workflow"], body),
	};
	assertProjectionCoherence(status, body);
	return status;
}

export async function fetchGenerationRunStatus(
	baseUrl: string,
	pair: GenerationRunParams,
): Promise<WalkGenerationRunStatus> {
	const response = await fetch(generationRunStatusUrl(baseUrl, pair));
	const body = await response.text();
	if (response.status !== 200) {
		throw new Error(
			`generation run ${pair.active_region_id}/${pair.publication_date} expected status 200, got ${response.status} ${body}`,
		);
	}
	return parseGenerationRunStatusResponse(body, pair);
}
