import type { ModelCompletion, ModelRuntimeEvidence } from "@bc-news/generation-core";
import type { CurrentProductionModelStep } from "./current-production-steps";

export class EvaluationRuntimeEvidenceError extends Error {
	readonly code = "evaluator_runtime_evidence_missing";

	constructor(productionStep: CurrentProductionModelStep) {
		super(`Live provider returned no runtime evidence for ${productionStep}`);
		this.name = "EvaluationRuntimeEvidenceError";
	}
}

export function requireRuntimeEvidence(
	completion: ModelCompletion,
	productionStep: CurrentProductionModelStep,
): ModelRuntimeEvidence {
	if (completion.runtime_evidence === undefined) {
		throw new EvaluationRuntimeEvidenceError(productionStep);
	}
	return completion.runtime_evidence;
}
