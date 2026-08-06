import { PRODUCTION_MODEL_STEPS, type ProductionModelStep } from "@bc-news/generation-core";
import type { EvalConfig } from "./config";
import type { ModelAdapterConfig } from "./model-adapters";

type LiveModelAdapterConfig = Exclude<ModelAdapterConfig, { readonly adapter: "recorded" }>;

export interface RecorderConfig {
	readonly production_steps: Readonly<Record<ProductionModelStep, LiveModelAdapterConfig>>;
}

export class RecorderConfigError extends Error {
	readonly code = "recorded_adapter_rejected";
	readonly productionStep: ProductionModelStep;

	constructor(productionStep: ProductionModelStep) {
		super(`Recorder config requires a live adapter for ${productionStep}; recorded replay is not allowed`);
		this.name = "RecorderConfigError";
		this.productionStep = productionStep;
	}
}

export function assertRecorderConfig(config: EvalConfig): asserts config is RecorderConfig {
	for (const productionStep of PRODUCTION_MODEL_STEPS) {
		if (config.production_steps[productionStep].adapter === "recorded") {
			throw new RecorderConfigError(productionStep);
		}
	}
}
