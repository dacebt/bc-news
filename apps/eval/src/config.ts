import { readFile } from "node:fs/promises";
import { z } from "zod";
import { ModelAdapterConfigSchema } from "./model-adapters";

const ProductionStepsConfigBaseSchema = z.strictObject({
	main_story_write: ModelAdapterConfigSchema,
	main_story_copyedit: ModelAdapterConfigSchema,
	announcements_write: ModelAdapterConfigSchema,
	announcements_copyedit: ModelAdapterConfigSchema,
});

/** One required adapter configuration for every production model step. */
export const ProductionStepsConfigSchema = ProductionStepsConfigBaseSchema.superRefine((steps, context) => {
	const lmStudioSteps = Object.entries(steps).filter(([, config]) => config.adapter === "lmstudio");
	if (lmStudioSteps.length === 0) return;
	const explicitSteps = lmStudioSteps.filter(([, config]) => config.adapter === "lmstudio" && config.sampling !== undefined);
	if (explicitSteps.length !== 0 && explicitSteps.length !== lmStudioSteps.length) {
		context.addIssue({
			code: "custom",
			message: "all LM Studio production steps must consistently omit sampling or provide a complete explicit tuple",
		});
	}
});

export const EvalConfigSchema = z.strictObject({
	production_steps: ProductionStepsConfigSchema,
});

export type EvalConfig = z.infer<typeof EvalConfigSchema>;

export type LmStudioSamplingPosture = "provider_default" | "explicit" | "not_applicable";

export function lmStudioSamplingPosture(config: {
	readonly production_steps: Record<string, { readonly adapter: string; readonly sampling?: unknown }>;
}): LmStudioSamplingPosture {
	const lmStudioSteps = Object.values(config.production_steps).filter(({ adapter }) => adapter === "lmstudio");
	if (lmStudioSteps.length === 0) return "not_applicable";
	const explicitCount = lmStudioSteps.filter(({ sampling }) => sampling !== undefined).length;
	if (explicitCount === 0) return "provider_default";
	if (explicitCount === lmStudioSteps.length) return "explicit";
	throw new Error("LM Studio sampling posture is inconsistent across production steps");
}

export const LiveBenchmarkConfigSchema = z.strictObject({
	configurations: z.array(EvalConfigSchema).min(1),
	repetition_count: z.number().int().positive(),
	transport_retry_limit: z.number().int().min(0).max(3),
}).superRefine((benchmark, context) => {
	const identities = benchmark.configurations.map((configuration) => JSON.stringify(configuration));
	if (new Set(identities).size !== identities.length) {
		context.addIssue({ code: "custom", path: ["configurations"], message: "benchmark configurations must have unique identities" });
	}
});

export type LiveBenchmarkConfig = z.infer<typeof LiveBenchmarkConfigSchema>;

export class LiveEvaluationConfigError extends Error {
	readonly code = "recorded_adapter_rejected_for_live_evaluation";
	constructor(path: string) {
		super(`Live evaluation config at ${path} cannot use the recorded adapter`);
		this.name = "LiveEvaluationConfigError";
	}
}

export class EvalConfigError extends Error {
	readonly code: "invalid_json" | "config_rejected";
	readonly path: string;

	constructor(code: "invalid_json" | "config_rejected", path: string, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "EvalConfigError";
		this.code = code;
		this.path = path;
	}
}

export async function loadConfig(path: string): Promise<EvalConfig> {
	const raw = await readFile(path, "utf8");
	let candidate: unknown;
	try {
		candidate = JSON.parse(raw);
	} catch (cause) {
		throw new EvalConfigError("invalid_json", path, `Config at ${path} is not valid JSON`, { cause });
	}
	const result = EvalConfigSchema.safeParse(candidate);
	if (!result.success) {
		throw new EvalConfigError(
			"config_rejected",
			path,
			`Config at ${path} must configure exactly the four production steps: ${result.error.message}`,
		);
	}
	return result.data;
}

export async function loadLiveEvaluationConfig(path: string): Promise<EvalConfig> {
	const config = await loadConfig(path);
	if (Object.values(config.production_steps).some(({ adapter }) => adapter === "recorded")) {
		throw new LiveEvaluationConfigError(path);
	}
	return config;
}

export async function loadLiveBenchmarkConfig(path: string): Promise<LiveBenchmarkConfig> {
	const raw = await readFile(path, "utf8");
	let candidate: unknown;
	try { candidate = JSON.parse(raw); }
	catch (cause) { throw new EvalConfigError("invalid_json", path, `Config at ${path} is not valid JSON`, { cause }); }
	const parsed = LiveBenchmarkConfigSchema.safeParse(candidate);
	if (!parsed.success) throw new EvalConfigError("config_rejected", path, `Benchmark config at ${path} was rejected: ${parsed.error.message}`);
	if (parsed.data.configurations.some((configuration) => Object.values(configuration.production_steps).some(({ adapter }) => adapter === "recorded"))) {
		throw new LiveEvaluationConfigError(path);
	}
	return parsed.data;
}
