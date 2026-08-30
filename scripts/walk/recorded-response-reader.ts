import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RecordedModelResponseSchema } from "../../packages/fixtures/src/recorded-response";

import type { RecordedProductionStep, RecordedResponse } from "./recorded-response";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MODEL_RESPONSES = join(REPO_ROOT, "packages", "fixtures", "model-responses");

export async function readRecordedResponse(
	productionStep: RecordedProductionStep,
): Promise<RecordedResponse> {
	const raw = await readFile(join(MODEL_RESPONSES, `${productionStep}.json`), "utf8");
	const parsed = RecordedModelResponseSchema.parse(JSON.parse(raw) as unknown);
	if (parsed.production_step !== productionStep) {
		throw new Error(`${productionStep} recorded response has an invalid record`);
	}

	return {
		production_step: productionStep,
		provider: parsed.provider,
		model: parsed.model,
		prompt_sha256: parsed.prompt_sha256,
		text: parsed.text,
	};
}
