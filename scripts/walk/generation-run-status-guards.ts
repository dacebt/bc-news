import {
	GENERATION_STEPS,
	LEGACY_GENERATION_STEPS,
	type CurrentV1WalkGenerationStep,
	type LegacyWalkCopyeditStep,
	type LegacyWalkGenerationStep,
	type LegacyWalkProductionStep,
	type WalkCurrentEditorialDiagnostic,
	type WalkFinalProductDiagnosticCode,
	type WalkGenerationState,
	type WalkLegacyEditorialDiagnostic,
	type WalkPreservationDiagnosticCode,
	type WalkProductionStep,
	type WalkWorkflow,
	type WalkWorkflowStatus,
} from "./generation-run-status-types";

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function hasRequiredAndOptionalKeys(
	value: Record<string, unknown>,
	requiredKeys: readonly string[],
	optionalKeys: readonly string[],
): boolean {
	const presentKeys = Object.keys(value);
	return (
		presentKeys.length >= requiredKeys.length &&
		presentKeys.length <= requiredKeys.length + optionalKeys.length &&
		requiredKeys.every((key) => Object.hasOwn(value, key)) &&
		presentKeys.every((key) => requiredKeys.includes(key) || optionalKeys.includes(key))
	);
}

export function hasOwn(value: Record<string, unknown>, key: string): boolean {
	return Object.hasOwn(value, key);
}

export function isGenerationStep(value: unknown): value is CurrentV1WalkGenerationStep {
	return GENERATION_STEPS.some((step) => step === value);
}

export function isLegacyGenerationStep(value: unknown): value is LegacyWalkGenerationStep {
	return LEGACY_GENERATION_STEPS.some((step) => step === value);
}

export function isProductionStep(value: unknown): value is WalkProductionStep {
	return value === "main_story_write" || value === "announcements_write";
}

export function isLegacyProductionStep(value: unknown): value is LegacyWalkProductionStep {
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

export function parseCurrentEditorialDiagnostic(
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

export function parseLegacyEditorialDiagnostic(
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

export function parseDiagnostics<Diagnostic>(
	value: unknown,
	body: string,
	parseDiagnostic: (diagnostic: unknown, source: string) => Diagnostic,
): Diagnostic[] {
	if (!Array.isArray(value)) {
		throw new Error(`generation run operator status has invalid diagnostics: ${body}`);
	}
	return value.map((diagnostic) => parseDiagnostic(diagnostic, body));
}

export function isGenerationState(value: unknown): value is WalkGenerationState {
	return value === "queued" || value === "running" || value === "complete" || value === "errored";
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

export function parseWorkflow(value: unknown, body: string): WalkWorkflow {
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
		return { observation: "unavailable", error: parseErrorShape(value["error"], body) };
	}
	throw new Error(`generation run operator status has invalid workflow: ${body}`);
}
