import type { GenerationRunParams } from "@bc-news/contracts";

const CURRENT_GENERATION_RUN_CONTRACT_VERSION = "current_v1";

export const GENERATION_STEPS = [
	"prepare-evidence",
	"main_story_write",
	"announcements_write",
	"validate-edition",
	"publish-edition",
] as const;

const LEGACY_GENERATION_STEPS = [
	"prepare-evidence",
	"main_story_write",
	"main_story_copyedit",
	"announcements_write",
	"announcements_copyedit",
	"validate-edition",
	"publish-edition",
] as const;

type WalkGenerationStep = (typeof GENERATION_STEPS)[number];
type LegacyWalkGenerationStep = (typeof LEGACY_GENERATION_STEPS)[number];
type WalkProductionStep = "main_story_write" | "announcements_write";
type LegacyWalkProductionStep =
	| "main_story_write"
	| "main_story_copyedit"
	| "announcements_write"
	| "announcements_copyedit";
type WalkWriterStep = WalkProductionStep;
type LegacyWalkCopyeditStep = "main_story_copyedit" | "announcements_copyedit";
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
type WalkGenerationState = "queued" | "running" | "complete" | "errored";
type WalkWorkflow =
	| { observation: "available"; status: WalkWorkflowStatus; error: { name: string; message: string } | null }
	| { observation: "unavailable"; error: { name: string; message: string } };

export interface WalkModelUsageRecord {
	production_step: WalkProductionStep;
	provider: string;
	model: string;
	execution: WalkExecution;
	token_usage: WalkTokenUsage;
	external_billing: WalkExternalBilling;
}

interface LegacyWalkModelUsageRecord {
	production_step: LegacyWalkProductionStep;
	provider: string;
	model: string;
	execution: WalkExecution;
	token_usage: WalkTokenUsage;
	external_billing: WalkExternalBilling;
}

type WalkCurrentEditorialDiagnostic = {
	kind: "final_product";
	production_step: WalkWriterStep;
	code: WalkFinalProductDiagnosticCode;
	message: string;
};

type WalkLegacyEditorialDiagnostic =
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

export type WalkEditorialDiagnostic = WalkCurrentEditorialDiagnostic | WalkLegacyEditorialDiagnostic;

type WalkFailure<Step extends string> = {
	step: Step | "configure-generation-run" | "launch-generation-run";
	code: string;
	message: string;
};

interface WalkGenerationRunStatusBase<
	Step extends string,
	ModelUsage extends { production_step: string },
	Diagnostic extends { production_step: string },
> {
	active_region_id: string;
	publication_date: string;
	generation_run_id: string;
	state: WalkGenerationState;
	current_step: Step | null;
	completed_steps: Step[];
	model_usage: ModelUsage[];
	diagnostics: Diagnostic[];
	failure: WalkFailure<Step> | null;
	workflow: WalkWorkflow;
}

export interface CurrentWalkGenerationRunStatus
	extends WalkGenerationRunStatusBase<
		WalkGenerationStep,
		WalkModelUsageRecord,
		WalkCurrentEditorialDiagnostic
	> {
	contract_version: typeof CURRENT_GENERATION_RUN_CONTRACT_VERSION;
}

export type LegacyWalkGenerationRunStatus = WalkGenerationRunStatusBase<
	LegacyWalkGenerationStep,
	LegacyWalkModelUsageRecord,
	WalkLegacyEditorialDiagnostic
>;

export type WalkGenerationRunStatus =
	| CurrentWalkGenerationRunStatus
	| LegacyWalkGenerationRunStatus;

export interface GenerationRunStatusHttpResponse {
	status: number;
	body: string;
	cacheControl: string | null;
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

function hasOwn(value: Record<string, unknown>, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(value, key);
}

function isGenerationStep(value: unknown): value is WalkGenerationStep {
	return GENERATION_STEPS.some((step) => step === value);
}

function isLegacyGenerationStep(value: unknown): value is LegacyWalkGenerationStep {
	return LEGACY_GENERATION_STEPS.some((step) => step === value);
}

function isProductionStep(value: unknown): value is WalkProductionStep {
	return value === "main_story_write" || value === "announcements_write";
}

function isLegacyProductionStep(value: unknown): value is LegacyWalkProductionStep {
	return (
		value === "main_story_write" ||
		value === "main_story_copyedit" ||
		value === "announcements_write" ||
		value === "announcements_copyedit"
	);
}

function isLegacyCopyeditStep(value: unknown): value is LegacyWalkCopyeditStep {
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

function parseCurrentEditorialDiagnostic(
	value: unknown,
	body: string,
): WalkCurrentEditorialDiagnostic {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ["kind", "production_step", "code", "message"]) ||
		value["kind"] !== "final_product" ||
		!isProductionStep(value["production_step"]) ||
		!isFinalProductDiagnosticCode(value["code"]) ||
		typeof value["message"] !== "string" ||
		value["message"].length === 0
	) {
		throw new Error(`generation run operator status has an invalid diagnostic: ${body}`);
	}
	return {
		kind: "final_product",
		production_step: value["production_step"],
		code: value["code"],
		message: value["message"],
	};
}

function parseLegacyEditorialDiagnostic(
	value: unknown,
	body: string,
): WalkLegacyEditorialDiagnostic {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ["kind", "production_step", "code", "message"]) ||
		!isLegacyCopyeditStep(value["production_step"]) ||
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

function parseDiagnostics<Diagnostic>(
	value: unknown,
	body: string,
	parseDiagnostic: (diagnostic: unknown, source: string) => Diagnostic,
): Diagnostic[] {
	if (!Array.isArray(value)) {
		throw new Error(`generation run operator status has invalid diagnostics: ${body}`);
	}
	return value.map((diagnostic) => parseDiagnostic(diagnostic, body));
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

function parseModelUsageFields<Step extends string>(
	value: unknown,
	body: string,
	isStep: (step: unknown) => step is Step,
): {
	production_step: Step;
	provider: string;
	model: string;
	execution: WalkExecution;
	token_usage: WalkTokenUsage;
	external_billing: WalkExternalBilling;
} {
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
		!isStep(productionStep) ||
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

function parseWorkflow(value: unknown, body: string): WalkWorkflow {
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

function isGenerationState(value: unknown): value is WalkGenerationState {
	return value === "queued" || value === "running" || value === "complete" || value === "errored";
}

function parseCompletedSteps<Step extends string>(
	value: unknown,
	body: string,
	isStep: (step: unknown) => step is Step,
): Step[] {
	if (!Array.isArray(value)) {
		throw new Error(`generation run operator status has invalid completed steps: ${body}`);
	}
	const completedSteps: Step[] = [];
	for (const step of value) {
		if (!isStep(step)) {
			throw new Error(`generation run operator status has invalid completed steps: ${body}`);
		}
		completedSteps.push(step);
	}
	return completedSteps;
}

function parseFailure<Step extends string>(
	value: unknown,
	body: string,
	isStep: (step: unknown) => step is Step,
): WalkFailure<Step> | null {
	if (value === null) return null;
	if (!isRecord(value) || !hasExactKeys(value, ["step", "code", "message"])) {
		throw new Error(`generation run operator status has invalid failure: ${body}`);
	}
	const step = value["step"];
	const code = value["code"];
	const message = value["message"];
	if (
		!(isStep(step) || step === "configure-generation-run" || step === "launch-generation-run") ||
		typeof code !== "string" ||
		code.length === 0 ||
		typeof message !== "string" ||
		message.length === 0
	) {
		throw new Error(`generation run operator status has invalid failure: ${body}`);
	}
	return { step, code, message };
}

function assertProjectionCoherence<
	Step extends string,
	ModelUsage extends { production_step: string },
	Diagnostic extends { production_step: string },
>(
	status: WalkGenerationRunStatusBase<Step, ModelUsage, Diagnostic>,
	body: string,
	allSteps: readonly Step[],
	productionSteps: readonly string[],
): void {
	if ((status.state === "running") !== (status.current_step !== null)) {
		throw new Error(`generation run operator status has incoherent current step: ${body}`);
	}
	if ((status.state === "errored") !== (status.failure !== null)) {
		throw new Error(`generation run operator status has incoherent failure: ${body}`);
	}
	if (status.completed_steps.some((step, index) => step !== allSteps[index])) {
		throw new Error(`generation run operator status has unordered completed steps: ${body}`);
	}
	if (
		status.state === "running" &&
		status.current_step !== allSteps[status.completed_steps.length]
	) {
		throw new Error(`generation run operator status has incoherent running step: ${body}`);
	}
	if (status.state === "complete" && status.completed_steps.length !== allSteps.length) {
		throw new Error(`generation run operator status has incomplete completed steps: ${body}`);
	}
	const expectedProductionSteps = status.completed_steps.reduce<string[]>((steps, step) => {
		if (productionSteps.includes(step)) {
			steps.push(step);
		}
		return steps;
	}, []);
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

interface ParsedStatusEnvelope {
	active_region_id: string;
	publication_date: string;
	generation_run_id: string;
	state: WalkGenerationState;
	current_step: unknown;
	completed_steps: unknown;
	model_usage: unknown[];
	diagnostics: unknown[];
	failure: unknown;
	workflow: unknown;
	contract_version?: unknown;
}

function parseStatusEnvelope(
	parsed: Record<string, unknown>,
	expectedPair: GenerationRunParams,
	body: string,
): ParsedStatusEnvelope {
	const state = parsed["state"];
	const modelUsage = parsed["model_usage"];
	const diagnostics = parsed["diagnostics"];
	if (
		parsed["active_region_id"] !== expectedPair.active_region_id ||
		parsed["publication_date"] !== expectedPair.publication_date ||
		parsed["generation_run_id"] !==
			`generation-run-${expectedPair.active_region_id}-${expectedPair.publication_date}` ||
		!isGenerationState(state) ||
		!Array.isArray(modelUsage) ||
		!Array.isArray(diagnostics)
	) {
		throw new Error(`generation run operator status has an invalid envelope: ${body}`);
	}
	return {
		active_region_id: expectedPair.active_region_id,
		publication_date: expectedPair.publication_date,
		generation_run_id: `generation-run-${expectedPair.active_region_id}-${expectedPair.publication_date}`,
		state,
		current_step: parsed["current_step"],
		completed_steps: parsed["completed_steps"],
		model_usage: modelUsage,
		diagnostics,
		failure: parsed["failure"],
		workflow: parsed["workflow"],
		...(hasOwn(parsed, "contract_version") ? { contract_version: parsed["contract_version"] } : {}),
	};
}

function parseCurrentGenerationRunStatusResponse(
	parsed: Record<string, unknown>,
	body: string,
	expectedPair: GenerationRunParams,
): CurrentWalkGenerationRunStatus {
	const envelope = parseStatusEnvelope(parsed, expectedPair, body);
	if (
		envelope.contract_version !== CURRENT_GENERATION_RUN_CONTRACT_VERSION ||
		!(envelope.current_step === null || isGenerationStep(envelope.current_step))
	) {
		throw new Error(`generation run operator status has an invalid envelope: ${body}`);
	}
	const status: CurrentWalkGenerationRunStatus = {
		contract_version: CURRENT_GENERATION_RUN_CONTRACT_VERSION,
		active_region_id: envelope.active_region_id,
		publication_date: envelope.publication_date,
		generation_run_id: envelope.generation_run_id,
		state: envelope.state,
		current_step: envelope.current_step,
		completed_steps: parseCompletedSteps(envelope.completed_steps, body, isGenerationStep),
		model_usage: envelope.model_usage.map((record) =>
			parseModelUsageFields(record, body, isProductionStep),
		),
		diagnostics: parseDiagnostics(envelope.diagnostics, body, parseCurrentEditorialDiagnostic),
		failure: parseFailure(envelope.failure, body, isGenerationStep),
		workflow: parseWorkflow(envelope.workflow, body),
	};
	assertProjectionCoherence(status, body, GENERATION_STEPS, ["main_story_write", "announcements_write"]);
	return status;
}

function parseLegacyGenerationRunStatusResponse(
	parsed: Record<string, unknown>,
	body: string,
	expectedPair: GenerationRunParams,
): LegacyWalkGenerationRunStatus {
	const envelope = parseStatusEnvelope(parsed, expectedPair, body);
	if (
		envelope.contract_version !== undefined ||
		!(envelope.current_step === null || isLegacyGenerationStep(envelope.current_step))
	) {
		throw new Error(`generation run operator status has an invalid envelope: ${body}`);
	}
	const status: LegacyWalkGenerationRunStatus = {
		active_region_id: envelope.active_region_id,
		publication_date: envelope.publication_date,
		generation_run_id: envelope.generation_run_id,
		state: envelope.state,
		current_step: envelope.current_step,
		completed_steps: parseCompletedSteps(envelope.completed_steps, body, isLegacyGenerationStep),
		model_usage: envelope.model_usage.map((record) =>
			parseModelUsageFields<LegacyWalkProductionStep>(
				record,
				body,
				isLegacyProductionStep,
			),
		),
		diagnostics: parseDiagnostics(envelope.diagnostics, body, parseLegacyEditorialDiagnostic),
		failure: parseFailure(envelope.failure, body, isLegacyGenerationStep),
		workflow: parseWorkflow(envelope.workflow, body),
	};
	assertProjectionCoherence(
		status,
		body,
		LEGACY_GENERATION_STEPS,
		["main_story_write", "main_story_copyedit", "announcements_write", "announcements_copyedit"],
	);
	return status;
}

export function generationRunStatusUrl(baseUrl: string, pair: GenerationRunParams): string {
	const query = new URLSearchParams(pair);
	return `${baseUrl}/generation-run?${query.toString()}`;
}

export async function requestGenerationRunStatus(
	baseUrl: string,
	pair: GenerationRunParams,
	operatorToken: string,
): Promise<GenerationRunStatusHttpResponse> {
	const response = await fetch(generationRunStatusUrl(baseUrl, pair), {
		headers: { Authorization: `Bearer ${operatorToken}` },
	});
	return {
		status: response.status,
		body: await response.text(),
		cacheControl: response.headers.get("cache-control"),
	};
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
	if (!isRecord(parsed)) {
		throw new Error(`generation run operator status has an invalid envelope: ${body}`);
	}
	if (hasOwn(parsed, "contract_version")) {
		return parseCurrentGenerationRunStatusResponse(parsed, body, expectedPair);
	}
	return parseLegacyGenerationRunStatusResponse(parsed, body, expectedPair);
}

export async function fetchGenerationRunStatus(
	baseUrl: string,
	pair: GenerationRunParams,
	operatorToken: string,
): Promise<WalkGenerationRunStatus> {
	const response = await requestGenerationRunStatus(baseUrl, pair, operatorToken);
	if (response.status !== 200) {
		throw new Error(
			`generation run ${pair.active_region_id}/${pair.publication_date} expected status 200, got ${response.status} ${response.body}`,
		);
	}
	const cacheDirectives = response.cacheControl
		?.split(",")
		.map((directive) => directive.trim().toLowerCase());
	if (!cacheDirectives?.includes("no-store")) {
		throw new Error(
			`generation run ${pair.active_region_id}/${pair.publication_date} expected Cache-Control: no-store, got ${JSON.stringify(response.cacheControl)}`,
		);
	}
	return parseGenerationRunStatusResponse(response.body, pair);
}
