import { createHash, randomUUID } from "node:crypto";
import {
	EditorialOutputContractError,
	type ModelProviderPort,
} from "@bc-news/generation-core";
import type { EvalConfig } from "./config";
import type { EvaluationFinding, V9BenchmarkRun, V9EvaluationTrial } from "./evaluation-artifact";
import type { CurrentProductionModelStep } from "./current-production-steps";
import { TransportFailureDetailsSchema, type TransportFailureDetails } from "./evaluation-artifact-schemas";
import { resolveModelProvider, type ModelProviderEnvironment } from "./model-adapters";

export function sha256Json(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function safeEvaluationId(prefix: string): string { return `${prefix}-${new Date().toISOString().replace(/[:.]/gu, "-")}-${randomUUID()}`; }
export function emptyOutcomeCounts(): V9BenchmarkRun["outcome_counts"] {
	return { completed: 0, parse_rejected: 0, contract_rejected: 0, infrastructure_incomplete: 0 };
}
export function emptyTrack(): V9EvaluationTrial["tracks"]["main_story"] {
	return { lifecycle: "pending", subject_outcome: null, terminal_production_step: null, product: null, findings: [] };
}
export function transportErrorIdentity(error: unknown): { code: string; message: string; details?: TransportFailureDetails } {
	if (error instanceof Error) {
		const details = "details" in error ? TransportFailureDetailsSchema.safeParse(error.details) : undefined;
		return {
			code: "code" in error && typeof error.code === "string" ? error.code : error.name,
			message: error.message,
			...(details?.success === true ? { details: details.data } : {}),
		};
	}
	return { code: "unknown_transport_failure", message: String(error) };
}
export function parseFinding(error: unknown): EvaluationFinding | undefined {
	if (error instanceof EditorialOutputContractError) return { kind: error.code, production_step: error.productionStep, code: error.code, message: error.message };
	return undefined;
}
export function terminalCurrentTrackOutcome(trial: V9EvaluationTrial, track: "main_story" | "announcements"): "completed" | "parse_rejected" | "contract_rejected" | "infrastructure_incomplete" {
	const writerStep: CurrentProductionModelStep = track === "main_story"
		? "main_story_write"
		: "announcements_write";
	const invocations = trial.invocations.filter(({ production_step }) => production_step === writerStep);
	const selectedId = trial.selected_invocation_ids[writerStep];
	const terminalInvocation = (selectedId === null ? undefined : invocations.find(({ id }) => id === selectedId)) ?? invocations.at(-1);
	const findings = terminalInvocation?.parse.state === "rejected" ? terminalInvocation.parse.findings : [];
	if (findings.some(({ kind }) => kind === "invalid_json")) return "parse_rejected";
	if (findings.some(({ kind }) => kind === "contract_mismatch")) return "contract_rejected";
	return terminalInvocation?.transport === "failed" ? "infrastructure_incomplete" : "completed";
}
export function providersFor(config: EvalConfig, environment: ModelProviderEnvironment): Record<CurrentProductionModelStep, ModelProviderPort> {
	return Object.fromEntries(Object.entries(config.production_steps).map(([step, adapter]) => [step, resolveModelProvider(step as CurrentProductionModelStep, adapter, environment)])) as Record<CurrentProductionModelStep, ModelProviderPort>;
}
