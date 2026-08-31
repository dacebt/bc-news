import type { GenerationRunParams } from "@bc-news/contracts";
import {
	CURRENT_V2_GENERATION_RUN_CONTRACT_VERSION,
	GENERATION_STEPS,
	WRITER_STEPS,
	type CurrentV2WalkGenerationRunStatus,
	type WalkModelAttemptOutcome,
	type WalkModelAttemptRecord,
	type WalkModelUsageRecord,
} from "./generation-run-status-types";
import {
	hasExactKeys,
	isGenerationStep,
	isProductionStep,
	isRecord,
	parseCurrentEditorialDiagnostic,
	parseDiagnostics,
	parseWorkflow,
} from "./generation-run-status-guards";
import { parseModelUsageFields } from "./generation-run-status-values";
import { assertProjectionCoherence, parseCompletedSteps, parseFailure, parseStatusEnvelope } from "./generation-run-status-projection";

function parseModelAttemptOutcome(value: unknown, body: string): WalkModelAttemptOutcome {
	if (!isRecord(value) || typeof value["status"] !== "string") {
		throw new Error(`generation run operator status has invalid model attempts: ${body}`);
	}
	if (value["status"] === "accepted" && hasExactKeys(value, ["status"])) {
		return { status: "accepted" };
	}
	if (
		value["status"] === "rejected" &&
		hasExactKeys(value, ["status", "code", "message"]) &&
		(value["code"] === "invalid_json" || value["code"] === "contract_mismatch") &&
		typeof value["message"] === "string" &&
		value["message"].trim().length > 0
	) {
		return { status: "rejected", code: value["code"], message: value["message"] };
	}
	throw new Error(`generation run operator status has invalid model attempts: ${body}`);
}

function parseModelAttempt(value: unknown, body: string): WalkModelAttemptRecord {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ["production_step", "attempt", "invocation_id", "outcome", "model_usage"]) ||
		!isProductionStep(value["production_step"]) ||
		(value["attempt"] !== 1 && value["attempt"] !== 2) ||
		typeof value["invocation_id"] !== "string" ||
		value["invocation_id"].trim().length === 0
	) {
		throw new Error(`generation run operator status has invalid model attempts: ${body}`);
	}
	const modelUsage = parseModelUsageFields(value["model_usage"], body, isProductionStep);
	if (modelUsage.production_step !== value["production_step"]) {
		throw new Error(`generation run operator status has invalid model attempts: ${body}`);
	}
	return {
		production_step: value["production_step"],
		attempt: value["attempt"],
		invocation_id: value["invocation_id"],
		outcome: parseModelAttemptOutcome(value["outcome"], body),
		model_usage: modelUsage,
	};
}

function parseModelAttempts(value: unknown, body: string): WalkModelAttemptRecord[] {
	if (!Array.isArray(value)) {
		throw new Error(`generation run operator status has invalid model attempts: ${body}`);
	}
	return value.map((attempt) => parseModelAttempt(attempt, body));
}

function assertCurrentV2ProjectionCoherence(status: CurrentV2WalkGenerationRunStatus, body: string): void {
	assertProjectionCoherence(status, body, GENERATION_STEPS, WRITER_STEPS);
	const attemptsByWriter = new Map(WRITER_STEPS.map((writer) => [writer, [] as WalkModelAttemptRecord[]]));
	let previousWriterIndex = -1;
	for (const attempt of status.model_attempts) {
		const writerIndex = WRITER_STEPS.indexOf(attempt.production_step);
		if (writerIndex === -1 || writerIndex < previousWriterIndex) {
			throw new Error(`generation run operator status has incoherent model attempts: ${body}`);
		}
		previousWriterIndex = writerIndex;
		if (attempt.invocation_id !== `${status.generation_run_id}-${attempt.production_step}-attempt-${String(attempt.attempt)}`) {
			throw new Error(`generation run operator status has incoherent model attempts: ${body}`);
		}
		const provenance = attempt.model_usage.request_provenance;
		if (
			provenance !== undefined &&
			(provenance.correlation.run_id !== status.generation_run_id || provenance.correlation.invocation_id !== attempt.invocation_id)
		) {
			throw new Error(`generation run operator status has incoherent model attempts: ${body}`);
		}
		attemptsByWriter.get(attempt.production_step)!.push(attempt);
	}
	const acceptedUsages: WalkModelUsageRecord[] = [];
	let unresolvedWriter: (typeof WRITER_STEPS)[number] | null = null;
	for (const writer of WRITER_STEPS) {
		const writerAttempts = attemptsByWriter.get(writer)!;
		if (unresolvedWriter !== null && writerAttempts.length > 0) {
			throw new Error(`generation run operator status has incoherent model attempts: ${body}`);
		}
		if (writerAttempts.length === 0) continue;
		if (writerAttempts.length > 2 || writerAttempts.some((attempt, index) => attempt.attempt !== index + 1)) {
			throw new Error(`generation run operator status has incoherent model attempts: ${body}`);
		}
		const acceptedIndex = writerAttempts.findIndex((attempt) => attempt.outcome.status === "accepted");
		if (acceptedIndex !== -1 && acceptedIndex !== writerAttempts.length - 1) {
			throw new Error(`generation run operator status has incoherent model attempts: ${body}`);
		}
		if (acceptedIndex === -1) {
			if (status.completed_steps.includes(writer) || writerAttempts.at(-1)?.outcome.status !== "rejected") {
				throw new Error(`generation run operator status has incoherent model attempts: ${body}`);
			}
			if (writerAttempts.length === 1) {
				if (status.state !== "running" || status.current_step !== writer) {
					throw new Error(`generation run operator status has incoherent model attempts: ${body}`);
				}
			} else if (status.state !== "errored" || status.failure?.step !== writer) {
				throw new Error(`generation run operator status has incoherent model attempts: ${body}`);
			}
			unresolvedWriter = writer;
			continue;
		}
		if (!status.completed_steps.includes(writer)) {
			throw new Error(`generation run operator status has incoherent model attempts: ${body}`);
		}
		acceptedUsages.push(writerAttempts[acceptedIndex]!.model_usage);
	}
	if (
		status.model_usage.length !== acceptedUsages.length ||
		status.model_usage.some((record, index) => JSON.stringify(record) !== JSON.stringify(acceptedUsages[index]))
	) {
		throw new Error(`generation run operator status has incoherent model usage: ${body}`);
	}
	if (status.state === "complete" && acceptedUsages.length !== WRITER_STEPS.length) {
		throw new Error(`generation run operator status has incoherent model usage: ${body}`);
	}
}

export function parseCurrentV2GenerationRunStatusResponse(
	parsed: Record<string, unknown>,
	body: string,
	expectedPair: GenerationRunParams,
): CurrentV2WalkGenerationRunStatus {
	const envelope = parseStatusEnvelope(parsed, expectedPair, body, [
		"active_region_id",
		"publication_date",
		"generation_run_id",
		"state",
		"current_step",
		"completed_steps",
		"model_usage",
		"model_attempts",
		"diagnostics",
		"failure",
		"workflow",
		"contract_version",
	]);
	if (
		envelope.contract_version !== CURRENT_V2_GENERATION_RUN_CONTRACT_VERSION ||
		!(envelope.current_step === null || isGenerationStep(envelope.current_step)) ||
		envelope.model_attempts === undefined
	) {
		throw new Error(`generation run operator status has an invalid envelope: ${body}`);
	}
	const status: CurrentV2WalkGenerationRunStatus = {
		contract_version: CURRENT_V2_GENERATION_RUN_CONTRACT_VERSION,
		active_region_id: envelope.active_region_id,
		publication_date: envelope.publication_date,
		generation_run_id: envelope.generation_run_id,
		state: envelope.state,
		current_step: envelope.current_step,
		completed_steps: parseCompletedSteps(envelope.completed_steps, body, isGenerationStep),
		model_usage: envelope.model_usage.map((record) => parseModelUsageFields(record, body, isProductionStep)),
		model_attempts: parseModelAttempts(envelope.model_attempts, body),
		diagnostics: parseDiagnostics(envelope.diagnostics, body, parseCurrentEditorialDiagnostic),
		failure: parseFailure(envelope.failure, body, isGenerationStep),
		workflow: parseWorkflow(envelope.workflow, body),
	};
	assertCurrentV2ProjectionCoherence(status, body);
	return status;
}
