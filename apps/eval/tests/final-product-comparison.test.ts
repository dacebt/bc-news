import { expect, test } from "vitest";
import { compareRuns } from "../src/compare";

const mainStory = {
	headline: "A busy morning",
	lede: "The region woke early.",
	body: "Work began before sunrise.",
};

test("compares only editorial products retained by asymmetric historical runs", () => {
	const left = {
		id: "historical-full",
		steps: [
			{ capability: "main_story", output: { main_story: mainStory } },
			{ capability: "announcements", output: {
				announcements: [{ title: "First milestone", summary: "Built the first hall." }],
			} },
			{ capability: "packaging", output: {
				title: "Morning Dispatch",
				subtitle: "What happened overnight",
				main_story: mainStory,
				announcements: [{ title: "First milestone", summary: "Built the first hall." }],
				publication_date: "2026-08-05",
			} },
		],
	};
	const right = {
		id: "historical-main-story-only",
		steps: [{ capability: "main_story", output: { main_story: mainStory } }],
	};

	expect(compareRuns(left, right)).toEqual({
		leftId: "historical-full",
		rightId: "historical-main-story-only",
		differences: ["run.announcements", "run.mainStory.subtitle", "run.mainStory.title"],
	});
});

test("rejects an invalid current edition instead of falling back to retained steps", () => {
	const run = {
		id: "current-invalid-edition",
		edition: { title: "incomplete" },
		steps: [{ output: { main_story: mainStory } }],
	};

	expect(() => compareRuns(run, run)).toThrow();
});
