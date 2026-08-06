import { readFile } from "node:fs/promises";
import { z } from "zod";
import { ModelAdapterConfigSchema } from "./model-adapters";

/** One required adapter configuration for every production model step. */
export const ProductionStepsConfigSchema = z.strictObject({
	main_story_write: ModelAdapterConfigSchema,
	main_story_copyedit: ModelAdapterConfigSchema,
	announcements_write: ModelAdapterConfigSchema,
	announcements_copyedit: ModelAdapterConfigSchema,
});

export const EvalConfigSchema = z.strictObject({
	production_steps: ProductionStepsConfigSchema,
});

export type EvalConfig = z.infer<typeof EvalConfigSchema>;

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
