import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import { formatRunDetail } from "../src/report";
import { RunFileReadSchema } from "../src/run-file";

function hash(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function historicalRun(step: Record<string, unknown>) {
	return RunFileReadSchema.parse({
		id: "historical-run",
		steps: [step],
	});
}

test("reports historical runs without capability usage as externally unpriced", () => {
	const run = historicalRun({
		capability: "main_story",
		prompt_sha256: hash("prompt"),
		output: { main_story: {} },
		schema_valid: true,
		judge: null,
	});

	expect(formatRunDetail(run)).toContain("Total external USD: unavailable");
});

test("reports historical judgments without judge usage as externally unpriced", () => {
	const run = historicalRun({
		capability: "main_story",
		prompt_sha256: hash("prompt"),
		output: { main_story: {} },
		schema_valid: true,
		model_usage: {
			editorial_capability: "main_story",
			provider: "recorded",
			model: "recorded/main-story-v1",
			execution: "recorded_replay",
			token_usage: { measurement: "unavailable" },
			external_billing: { classification: "none", amount_usd: 0, reason: "recorded_replay" },
		},
		judge: {
			scores: { grounding: 5, voice: 4, structure: 4 },
			reasoning: "Historical judgment predates usage retention.",
			aggregate: 4.35,
			weighting: "v1_rubric_weighted_mean",
			provenance: {
				source: "recorded_replay",
				prompt_sha256: hash("judge prompt"),
				response_sha256: hash("judge response"),
			},
		},
	});

	expect(formatRunDetail(run)).toContain("Total external USD: unavailable");
});
