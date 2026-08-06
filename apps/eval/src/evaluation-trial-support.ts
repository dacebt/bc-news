import { createHash, randomUUID } from "node:crypto";
import {
	CopyeditPreservationError,
	EditorialOutputContractError,
	type ModelProviderPort,
	type ProductionModelStep,
} from "@bc-news/generation-core";
import type { EvalConfig } from "./config";
import type { BenchmarkRun, EvaluationFinding, EvaluationTrial, SubjectOutcome } from "./evaluation-artifact";
import { resolveModelProvider, type ModelProviderEnvironment } from "./model-adapters";

export function sha256Json(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function safeEvaluationId(prefix: string): string { return `${prefix}-${new Date().toISOString().replace(/[:.]/gu, "-")}-${randomUUID()}`; }
export function emptyOutcomeCounts(): BenchmarkRun["outcome_counts"] {
	return { completed: 0, parse_rejected: 0, contract_rejected: 0, preservation_rejected: 0, final_product_rejected: 0, infrastructure_incomplete: 0 };
}
export function emptyTrack(): EvaluationTrial["tracks"]["main_story"] {
	return { lifecycle: "pending", subject_outcome: null, terminal_production_step: null, product: null, findings: [] };
}
export function transportErrorIdentity(error: unknown): { code: string; message: string } {
	if (error instanceof Error) return { code: "code" in error && typeof error.code === "string" ? error.code : error.name, message: error.message };
	return { code: "unknown_transport_failure", message: String(error) };
}
export function parseFinding(error: unknown): EvaluationFinding | undefined {
	if (error instanceof EditorialOutputContractError) return { kind: error.code, production_step: error.productionStep, code: error.code, message: error.message };
	if (error instanceof CopyeditPreservationError) return { kind: "preservation", production_step: error.productionStep, code: error.code, message: error.message };
	return undefined;
}
function findingOutcome(finding: EvaluationFinding): SubjectOutcome {
	if (finding.kind === "invalid_json") return "parse_rejected";
	if (finding.kind === "contract_mismatch") return "contract_rejected";
	if (finding.kind === "preservation") return "preservation_rejected";
	return "final_product_rejected";
}
export function terminalTrackOutcome(trial: EvaluationTrial, track: "main_story" | "announcements", findings: readonly EvaluationFinding[]): SubjectOutcome {
	const writerStep = track === "main_story" ? "main_story_write" : "announcements_write";
	const copyeditStep = track === "main_story" ? "main_story_copyedit" : "announcements_copyedit";
	const terminalStep = trial.invocations.some(({ production_step }) => production_step === copyeditStep) ? copyeditStep : writerStep;
	const invocations = trial.invocations.filter(({ production_step }) => production_step === terminalStep);
	const selectedId = trial.selected_invocation_ids[terminalStep];
	const terminalInvocation = (selectedId === null ? undefined : invocations.find(({ id }) => id === selectedId)) ?? invocations.at(-1);
	const retained = [...findings, ...(terminalInvocation?.parse.state === "rejected" ? terminalInvocation.parse.findings : [])];
	for (const outcome of ["parse_rejected", "contract_rejected", "preservation_rejected", "final_product_rejected"] as const) if (retained.some((finding) => findingOutcome(finding) === outcome)) return outcome;
	return terminalInvocation?.transport === "failed" ? "infrastructure_incomplete" : "completed";
}
export function providersFor(config: EvalConfig, environment: ModelProviderEnvironment): Record<ProductionModelStep, ModelProviderPort> {
	return Object.fromEntries(Object.entries(config.production_steps).map(([step, adapter]) => [step, resolveModelProvider(step as ProductionModelStep, adapter, environment)])) as Record<ProductionModelStep, ModelProviderPort>;
}
