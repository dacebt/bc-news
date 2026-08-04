import { expect, test } from "vitest";
import { RUBRICS, rubricDimensionMismatch, rubricDimensionNames, rubricWeightedAggregate } from "../src/rubrics";

test("carries the binding v1 main-story weights", () => {
	expect(RUBRICS.main_story.map(({ name, weight }) => ({ name, weight }))).toEqual([
		{ name: "grounding", weight: 35 },
		{ name: "voice", weight: 25 },
		{ name: "structure", weight: 40 },
	]);
});

test("carries all three binding v1 capability rubrics", () => {
	expect(RUBRICS.announcements.map(({ name, weight }) => [name, weight])).toEqual([
		["completeness", 35], ["accuracy", 35], ["clarity", 15], ["coverage_quality", 15],
	]);
	expect(RUBRICS.packaging.map(({ name, weight }) => [name, weight])).toEqual([
		["preservation", 30], ["accuracy", 25], ["packaging", 20], ["metadata", 25],
	]);
});

test("keeps the frozen v1 announcement and packaging criteria verbatim", () => {
	expect(RUBRICS.announcements.map(({ description }) => description)).toEqual([
		"Did the output capture what happened? Look for:\n- Skill progressions and milestones mentioned in the source\n- Personal achievements worth noting\n- Discoveries or territorial developments\n- Missing events that should have been reported",
		"Is the reporting trustworthy? Check:\n- Player names match the source exactly\n- Levels and achievements correspond to what was said\n- No embellishment or invented details\n- Quotes (if any) appear verbatim in source",
		"Is the writing professional? Consider:\n- Clear, straightforward language\n- Appropriate level of detail\n- Consistent style across announcements\n- No awkward phrasing or jargon",
		"Does the announcement selection use the source well? Evaluate:\n- Newsworthy source events are represented without material omissions\n- Duplicate or trivial announcements do not crowd out stronger events\n- Emphasis reflects the significance of the source activity",
	]);
	expect(RUBRICS.packaging.map(({ description }) => description)).toEqual([
		"Was the previous stage's work respected? Check:\n- Original voice maintained throughout\n- Changes limited to factual corrections and typos\n- No over-editing or unnecessary tightening\n- Narrative structure preserved",
		"Is the final product clean? Look for:\n- Factual errors caught and fixed\n- No new errors introduced\n- Quotes verified against source\n- Numbers and names correct",
		"Does this feel like a finished product? Consider:\n- Appropriate edition title and subtitle\n- Professional presentation\n- Coherent package of announcements and story\n- Ready for reader consumption",
		"Are the edition identity fields correct? Verify:\n- Region ID and edition date match the expected values\n- Title and subtitle are present and appropriate\n- All required package fields are populated\n- No unsupported metadata was invented",
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
