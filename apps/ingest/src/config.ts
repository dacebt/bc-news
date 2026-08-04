import { z } from "zod";
import { parseDecimalInteger } from "./parsers";

const DEFAULT_POLL_LIMIT = 100;
const DEFAULT_POLL_OVERLAP_SECONDS = 10;
const DEFAULT_POLL_CURSOR_KEY = "chat_firehose";

interface IntegerRange {
	min: number;
	max: number;
}

// A limit below 1 is not a small poll, it is a hang: a page with rows never
// satisfies the caught-up exit (messages.length < limit) or the stuck
// detector (messages.length === limit), so the loop spins until the
// platform's own CPU limit kills it. The ceiling is not this deployment's own
// policy — it is BitJita's, observed directly against the live API:
// limit=200 returns HTTP 200 {"error":"Limit is too high"}, while limit=100
// succeeds. A configured value above 100 would ask BitJita for a page size
// it refuses on every single poll.
const POLL_LIMIT_RANGE: IntegerRange = { min: 1, max: 100 };

// Zero overlap is a legitimate choice (take the cursor at its word). The
// ceiling is one day: an overlap wider than that re-fetches more history on
// every tick than a day of chat contains, which is a misconfiguration rather
// than a tuning decision.
const POLL_OVERLAP_SECONDS_RANGE: IntegerRange = { min: 0, max: 86_400 };

/**
 * An optional decimal-integer env var, in range, with a fallback applied
 * only when the var is genuinely absent. A var that is set and unusable is
 * never silently replaced by the fallback: booting with a nonsense limit
 * quietly corrected to 100 is how a deployment stays broken without anyone
 * noticing.
 */
function boundedIntegerVar(name: string, range: IntegerRange, fallback: number) {
	return z
		.string()
		.optional()
		.transform((raw, ctx) => {
			if (raw === undefined) {
				return fallback;
			}
			const parsed = parseDecimalInteger(raw);
			if (parsed === null || parsed < range.min || parsed > range.max) {
				ctx.addIssue({
					code: "custom",
					message: `${name} must be a decimal integer between ${String(range.min)} and ${String(range.max)}, received ${JSON.stringify(raw)}`,
				});
				return z.NEVER;
			}
			return parsed;
		});
}

/**
 * The deployment-supplied half of the poll configuration. Declared narrower
 * than the Worker's Env so this module cannot reach the database binding:
 * the only thing it is allowed to do is turn config strings into a
 * validated PollConfig.
 */
export interface PollEnv {
	POLL_LIMIT?: string;
	POLL_OVERLAP_SECONDS?: string;
	POLL_CURSOR_KEY?: string;
	BITJITA_API_BASE?: string;
}

const PollEnvSchema = z.object({
	POLL_LIMIT: boundedIntegerVar("POLL_LIMIT", POLL_LIMIT_RANGE, DEFAULT_POLL_LIMIT),
	POLL_OVERLAP_SECONDS: boundedIntegerVar(
		"POLL_OVERLAP_SECONDS",
		POLL_OVERLAP_SECONDS_RANGE,
		DEFAULT_POLL_OVERLAP_SECONDS,
	),
	POLL_CURSOR_KEY: z
		.string()
		.min(1)
		.optional()
		.transform((raw) => raw ?? DEFAULT_POLL_CURSOR_KEY),
	// No default: a deployment that forgets to set this must reject rather
	// than silently poll production BitJita.
	BITJITA_API_BASE: z.url(),
});

export interface PollConfig {
	pollLimit: number;
	pollOverlapSeconds: number;
	pollCursorKey: string;
	bitjitaApiBase: string;
}

export class IngestConfigError extends Error {
	readonly code = "invalid_ingest_config";

	constructor(message: string) {
		super(message);
		this.name = "IngestConfigError";
	}
}

export function resolvePollConfig(env: PollEnv): PollConfig {
	const result = PollEnvSchema.safeParse(env);
	if (!result.success) {
		throw new IngestConfigError(`Poll config vars rejected: ${result.error.message}`);
	}
	return {
		pollLimit: result.data.POLL_LIMIT,
		pollOverlapSeconds: result.data.POLL_OVERLAP_SECONDS,
		pollCursorKey: result.data.POLL_CURSOR_KEY,
		bitjitaApiBase: result.data.BITJITA_API_BASE,
	};
}
