import { expect, test } from "vitest";
import { RUBRICS, rubricDimensionMismatch, rubricDimensionNames, rubricWeightedAggregate } from "../src/rubrics";

test("carries the binding v1 main-story weights", () => {
	expect(RUBRICS.main_story.map(({ name, weight }) => ({ name, weight }))).toEqual([
		{ name: "grounding", weight: 35 },
		{ name: "voice", weight: 25 },
		{ name: "structure", weight: 40 },
	]);
});

test("carries the binding v1 main-story criteria", () => {
	expect(RUBRICS.main_story[0]?.description).toContain("Quotes appear verbatim in the chat messages");
	expect(RUBRICS.main_story[1]?.description).toContain("Dry wit without winking at the reader");
	expect(RUBRICS.main_story[2]?.description).toContain("Lede that hooks without overselling");
});

test("aggregates main-story scores with the binding v1 weights", () => {
	expect(rubricWeightedAggregate("main_story", { grounding: 5, voice: 4, structure: 4 })).toBe(4.35);
});

test("names every dimension of the main_story rubric", () => {
	expect(rubricDimensionNames("main_story")).toEqual(["grounding", "voice", "structure"]);
});

test("reports no mismatch when scores match the rubric exactly", () => {
	const mismatch = rubricDimensionMismatch("main_story", { grounding: 5, voice: 4, structure: 3 });
	expect(mismatch).toEqual({ missing: [], unexpected: [] });
});

test("reports a missing dimension", () => {
	const mismatch = rubricDimensionMismatch("main_story", { grounding: 5, voice: 4 });
	expect(mismatch.missing).toEqual(["structure"]);
	expect(mismatch.unexpected).toEqual([]);
});

test("reports an unexpected dimension", () => {
	const mismatch = rubricDimensionMismatch("main_story", {
		grounding: 5,
		voice: 4,
		structure: 3,
		tone: 5,
	});
	expect(mismatch.missing).toEqual([]);
	expect(mismatch.unexpected).toEqual(["tone"]);
});
