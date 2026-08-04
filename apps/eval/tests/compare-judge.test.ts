import { expect, test } from "vitest";
import { compareRuns } from "../src/compare";
import { formatRunComparison } from "../src/report";
import { RunFileReadSchema, type RunFileRead } from "../src/run-file";

function runWithJudge(id: string, judge: unknown, capability = "main_story"): RunFileRead {
	return RunFileReadSchema.parse({
		id,
		steps: [
			{
				capability,
				output: { main_story: { headline: "h" } },
				checks: [],
				judge,
			},
		],
	});
}

test("aggregates judge scores per dimension between two judged runs", () => {
	const left = runWithJudge("left", {
		scores: { grounding: 5, voice: 4, structure: 3 },
		reasoning: "a",
		aggregate: 3.95,
		weighting: "v1_rubric_weighted_mean",
		provenance: { source: "recorded_replay", prompt_sha256: "1".repeat(64), response_sha256: "2".repeat(64) },
	});
	const right = runWithJudge("right", {
		scores: { grounding: 4, voice: 4, structure: 5 },
		reasoning: "b",
		aggregate: 4.4,
		weighting: "v1_rubric_weighted_mean",
		provenance: { source: "recorded_replay", prompt_sha256: "1".repeat(64), response_sha256: "2".repeat(64) },
	});

	const comparison = compareRuns(left, right);
	const step = comparison.steps.find((entry) => entry.capability === "main_story");

	expect(step?.judge.weighting).toBe("v1_rubric_weighted_mean");
	expect(step?.judge.rubricMismatch).toBeNull();
	expect(step?.judge.aggregateLeft).toBe(3.95);
	expect(step?.judge.aggregateRight).toBeCloseTo(4.4);
	expect(step?.judge.dimensions).toEqual([
		{ name: "grounding", left: 5, right: 4, changed: true },
		{ name: "voice", left: 4, right: 4, changed: false },
		{ name: "structure", left: 3, right: 5, changed: true },
	]);
});

test("degrades a judge-less side to null, never zero", () => {
	const left = runWithJudge("left", {
		scores: { grounding: 5, voice: 4, structure: 3 },
		reasoning: "a",
		aggregate: 3.95,
		weighting: "v1_rubric_weighted_mean",
		provenance: { source: "recorded_replay", prompt_sha256: "1".repeat(64), response_sha256: "2".repeat(64) },
	});
	const right = runWithJudge("right", null);

	const comparison = compareRuns(left, right);
	const step = comparison.steps.find((entry) => entry.capability === "main_story");

	expect(step?.judge.aggregateRight).toBeNull();
	expect(step?.judge.dimensions.every((dimension) => dimension.right === null)).toBe(true);
	expect(step?.judge.dimensions.some((dimension) => dimension.right === 0)).toBe(false);
});

test("degrades a malformed judge value on the read path to null instead of throwing", () => {
	const left = runWithJudge("left", {
		scores: { grounding: 5, voice: 4, structure: 3 },
		reasoning: "a",
		aggregate: 3.95,
		weighting: "v1_rubric_weighted_mean",
		provenance: { source: "recorded_replay", prompt_sha256: "1".repeat(64), response_sha256: "2".repeat(64) },
	});
	const right = runWithJudge("right", { not: "a judge step" });

	const comparison = compareRuns(left, right);
	const step = comparison.steps.find((entry) => entry.capability === "main_story");

	expect(step?.judge.aggregateRight).toBeNull();
});

test("surfaces a judged historical capability with no current rubric", () => {
	const judged = {
		scores: { grounding: 5, voice: 4, structure: 3 },
		reasoning: "a",
		aggregate: 3.95,
		weighting: "v1_rubric_weighted_mean",
		provenance: { source: "recorded_replay", prompt_sha256: "1".repeat(64), response_sha256: "2".repeat(64) },
	};
	const left = runWithJudge("left", judged, "retired_story");
	const right = runWithJudge("right", judged, "retired_story");

	const comparison = compareRuns(left, right);
	const step = comparison.steps.find((entry) => entry.capability === "retired_story");

	expect(step?.judge.rubricMismatch).toBe(
		'Judged historical capability "retired_story" has no current rubric',
	);
	expect(step?.judge.dimensions.map((dimension) => dimension.name)).toEqual([
		"grounding",
		"structure",
		"voice",
	]);
	expect(formatRunComparison(comparison)).toContain(
		'Judge rubric mismatch: Judged historical capability "retired_story" has no current rubric',
	);
});
