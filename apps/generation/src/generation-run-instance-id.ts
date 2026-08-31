import type { GenerationRunParams } from "@bc-news/contracts";
import type { ProductionModelStep } from "@bc-news/generation-core";

export function generationRunInstanceId(params: GenerationRunParams): string {
	return `generation-run-${params.active_region_id}-${params.publication_date}`;
}

export function generationRunAttemptInvocationId(
	params: GenerationRunParams,
	productionStep: ProductionModelStep,
	attempt: 1 | 2,
): string {
	return `${generationRunInstanceId(params)}-${productionStep}-attempt-${attempt}`;
}
