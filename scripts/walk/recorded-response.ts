import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const RECORDED_PRODUCTION_STEPS = [
	"main_story_write",
	"main_story_copyedit",
	"announcements_write",
	"announcements_copyedit",
] as const;

export type RecordedProductionStep = (typeof RECORDED_PRODUCTION_STEPS)[number];

export interface RecordedResponse {
	production_step: RecordedProductionStep;
	provider: string;
	model: string;
	prompt_sha256: string;
	text: string;
}

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MODEL_RESPONSES = join(REPO_ROOT, "packages", "fixtures", "model-responses");
const RECORD_KEYS = ["production_step", "provider", "model", "prompt_sha256", "text"] as const;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readRecordedResponse(
	productionStep: RecordedProductionStep,
): Promise<RecordedResponse> {
	const raw = await readFile(join(MODEL_RESPONSES, `${productionStep}.json`), "utf8");
	const value = JSON.parse(raw) as unknown;
	if (
		!isRecord(value) ||
		Object.keys(value).length !== RECORD_KEYS.length ||
		!RECORD_KEYS.every((key) => Object.prototype.hasOwnProperty.call(value, key))
	) {
		throw new Error(`${productionStep} recorded response has an invalid record`);
	}

	const recordProductionStep = value.production_step;
	const provider = value.provider;
	const model = value.model;
	const promptSha256 = value.prompt_sha256;
	const text = value.text;
	if (
		recordProductionStep !== productionStep ||
		typeof provider !== "string" ||
		provider.length === 0 ||
		typeof model !== "string" ||
		model.length === 0 ||
		typeof promptSha256 !== "string" ||
		!SHA256_PATTERN.test(promptSha256) ||
		typeof text !== "string" ||
		text.length === 0
	) {
		throw new Error(`${productionStep} recorded response has an invalid record`);
	}

	return {
		production_step: productionStep,
		provider,
		model,
		prompt_sha256: promptSha256,
		text,
	};
}
