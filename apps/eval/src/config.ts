import { readFile } from "node:fs/promises";
import { z } from "zod";
import { ModelAdapterConfigSchema } from "./model-adapters";

/**
 * One key per roster entry, deliberately: slice B has not merged, so the
 * roster is main_story only (DISPATCH FACT). Extending the roster is adding
 * a key here plus a capability-runner entry (capability-runners.ts) and a
 * ROSTER entry (run-command.ts) -- never a restructure.
 */
export const CapabilitiesConfigSchema = z.strictObject({
	main_story: ModelAdapterConfigSchema,
});

export const EvalConfigSchema = z.strictObject({
	capabilities: CapabilitiesConfigSchema,
	judge: ModelAdapterConfigSchema.nullable(),
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
			`Config at ${path} does not match the eval config contract: ${result.error.message}`,
		);
	}
	return result.data;
}
