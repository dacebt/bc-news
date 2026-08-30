import { PRODUCTION_MODEL_STEPS } from "@bc-news/generation-core";
import type { EvalConfig } from "./config";
import type { RunFile } from "./run-file";

export function assertRecordedReplayConfig(config: EvalConfig): void {
	for (const step of PRODUCTION_MODEL_STEPS) {
		if (config.production_steps[step].adapter !== "recorded") {
			throw new Error(`recorded-replay acceptance must use recorded replay for ${step}`);
		}
	}
}

export function assertRecordedReplayAcceptanceSemantics(run: RunFile): void {
	assertRecordedReplayConfig(run.config);
	if (run.steps.some((step, index) => step.production_step !== PRODUCTION_MODEL_STEPS[index])) {
		throw new Error("recorded-replay acceptance does not contain the exact ordered two-step roster");
	}
	for (const step of run.steps) {
		const usage = step.model_usage;
		if (
			usage.production_step !== step.production_step
			|| usage.execution !== "recorded_replay"
			|| usage.token_usage.measurement !== "unavailable"
			|| usage.external_billing.classification !== "none"
			|| usage.external_billing.amount_usd !== 0
			|| usage.external_billing.reason !== "recorded_replay"
		) {
			throw new Error(`${step.production_step} does not carry recorded-replay/no-billing usage`);
		}
	}
}
