import type { GenerationRunParams } from "@bc-news/contracts";
import {
	CURRENT_V1_GENERATION_RUN_CONTRACT_VERSION,
	GENERATION_STEPS,
	LEGACY_GENERATION_STEPS,
	STATUS_METADATA_KEYS,
	WRITER_STEPS,
	type CurrentV1WalkGenerationRunStatus,
	type LegacyWalkGenerationRunStatus,
	type LegacyWalkProductionStep,
	type ParsedStatusEnvelope,
	type WalkFailure,
	type WalkGenerationRunStatusBase,
} from "./generation-run-status-types";
import {
	hasOwn,
	hasRequiredAndOptionalKeys,
	hasExactKeys,
	isGenerationState,
	isGenerationStep,
	isLegacyGenerationStep,
	isLegacyProductionStep,
	isProductionStep,
	isRecord,
	parseCurrentEditorialDiagnostic,
	parseDiagnostics,
	parseLegacyEditorialDiagnostic,
	parseWorkflow,
} from "./generation-run-status-guards";
import { parseModelUsageFields } from "./generation-run-status-values";

export function parseCompletedSteps<Step extends string>(
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

export function parseFailure<Step extends string>(
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

export function assertProjectionCoherence<
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
	if (status.state === "running" && status.current_step !== allSteps[status.completed_steps.length]) {
		throw new Error(`generation run operator status has incoherent running step: ${body}`);
	}
	if (status.state === "complete" && status.completed_steps.length !== allSteps.length) {
		throw new Error(`generation run operator status has incomplete completed steps: ${body}`);
	}
	const expectedProductionSteps = status.completed_steps.reduce<string[]>((steps, step) => {
		if (productionSteps.includes(step)) steps.push(step);
		return steps;
	}, []);
	if (
		status.model_usage.length !== expectedProductionSteps.length ||
		status.model_usage.some((record, index) => record.production_step !== expectedProductionSteps[index])
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

export function parseStatusEnvelope(
	parsed: Record<string, unknown>,
	expectedPair: GenerationRunParams,
	body: string,
	expectedKeys: readonly string[],
): ParsedStatusEnvelope {
	const state = parsed["state"];
	const modelUsage = parsed["model_usage"];
	const modelAttempts = parsed["model_attempts"];
	const diagnostics = parsed["diagnostics"];
	const createdAtUtc = parsed["created_at_utc"];
	const updatedAtUtc = parsed["updated_at_utc"];
	if (
		!hasRequiredAndOptionalKeys(parsed, expectedKeys, STATUS_METADATA_KEYS) ||
		parsed["active_region_id"] !== expectedPair.active_region_id ||
		parsed["publication_date"] !== expectedPair.publication_date ||
		parsed["generation_run_id"] !==
			`generation-run-${expectedPair.active_region_id}-${expectedPair.publication_date}` ||
		!isGenerationState(state) ||
		(createdAtUtc !== undefined && (typeof createdAtUtc !== "string" || createdAtUtc.trim().length === 0)) ||
		(updatedAtUtc !== undefined && (typeof updatedAtUtc !== "string" || updatedAtUtc.trim().length === 0)) ||
		!Array.isArray(modelUsage) ||
		(modelAttempts !== undefined && !Array.isArray(modelAttempts)) ||
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
		...(modelAttempts === undefined ? {} : { model_attempts: modelAttempts }),
		diagnostics,
		failure: parsed["failure"],
		workflow: parsed["workflow"],
		...(hasOwn(parsed, "contract_version") ? { contract_version: parsed["contract_version"] } : {}),
	};
}

export function parseCurrentV1GenerationRunStatusResponse(
	parsed: Record<string, unknown>,
	body: string,
	expectedPair: GenerationRunParams,
): CurrentV1WalkGenerationRunStatus {
	const envelope = parseStatusEnvelope(parsed, expectedPair, body, [
		"active_region_id",
		"publication_date",
		"generation_run_id",
		"state",
		"current_step",
		"completed_steps",
		"model_usage",
		"diagnostics",
		"failure",
		"workflow",
		"contract_version",
	]);
	if (
		envelope.contract_version !== CURRENT_V1_GENERATION_RUN_CONTRACT_VERSION ||
		!(envelope.current_step === null || isGenerationStep(envelope.current_step))
	) {
		throw new Error(`generation run operator status has an invalid envelope: ${body}`);
	}
	const status: CurrentV1WalkGenerationRunStatus = {
		contract_version: CURRENT_V1_GENERATION_RUN_CONTRACT_VERSION,
		active_region_id: envelope.active_region_id,
		publication_date: envelope.publication_date,
		generation_run_id: envelope.generation_run_id,
		state: envelope.state,
		current_step: envelope.current_step,
		completed_steps: parseCompletedSteps(envelope.completed_steps, body, isGenerationStep),
		model_usage: envelope.model_usage.map((record) => parseModelUsageFields(record, body, isProductionStep)),
		diagnostics: parseDiagnostics(envelope.diagnostics, body, parseCurrentEditorialDiagnostic),
		failure: parseFailure(envelope.failure, body, isGenerationStep),
		workflow: parseWorkflow(envelope.workflow, body),
	};
	assertProjectionCoherence(status, body, GENERATION_STEPS, WRITER_STEPS);
	return status;
}

export function parseLegacyGenerationRunStatusResponse(
	parsed: Record<string, unknown>,
	body: string,
	expectedPair: GenerationRunParams,
): LegacyWalkGenerationRunStatus {
	const envelope = parseStatusEnvelope(parsed, expectedPair, body, [
		"active_region_id",
		"publication_date",
		"generation_run_id",
		"state",
		"current_step",
		"completed_steps",
		"model_usage",
		"diagnostics",
		"failure",
		"workflow",
	]);
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
			parseModelUsageFields<LegacyWalkProductionStep>(record, body, isLegacyProductionStep),
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
