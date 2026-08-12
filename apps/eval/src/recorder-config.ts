import { PRODUCTION_MODEL_STEPS, type ProductionModelStep } from "@bc-news/generation-core";
import type { EvalConfig } from "./config";
import type { ModelAdapterConfig } from "./model-adapters";

type LiveModelAdapterConfig = Exclude<ModelAdapterConfig, { readonly adapter: "recorded" | "cloudflare_ai_gateway" }>;

export interface RecorderConfig {
	readonly production_steps: Readonly<Record<ProductionModelStep, LiveModelAdapterConfig>>;
}

export class RecorderConfigError extends Error {
	readonly code: "recorded_adapter_rejected" | "cloudflare_ai_gateway_recording_not_supported";
	readonly productionStep: ProductionModelStep;

	constructor(productionStep: ProductionModelStep, adapter: "recorded" | "cloudflare_ai_gateway" = "recorded") {
		super(adapter === "recorded"
			? `Recorder config requires a live adapter for ${productionStep}; recorded replay is not allowed`
			: `Recorder configuration format does not yet retain cloudflare_ai_gateway for ${productionStep}`);
		this.name = "RecorderConfigError";
		this.code = adapter === "recorded" ? "recorded_adapter_rejected" : "cloudflare_ai_gateway_recording_not_supported";
		this.productionStep = productionStep;
	}
}

export function assertRecorderConfig(config: EvalConfig): asserts config is RecorderConfig {
	for (const productionStep of PRODUCTION_MODEL_STEPS) {
		const adapter = config.production_steps[productionStep].adapter;
		if (adapter === "recorded" || adapter === "cloudflare_ai_gateway") {
			throw new RecorderConfigError(productionStep, adapter);
		}
	}
}
