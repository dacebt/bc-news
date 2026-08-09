import { expect, test } from "vitest";
import { compareRuns } from "../src/compare";
import { formatRunComparison } from "../src/report";

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

test("compares diagnostics only when both runs retained observed diagnostics", () => {
	const product = { main_story: mainStory };
	const leftDiagnostic = {
		kind: "final_product" as const,
		production_step: "main_story_copyedit" as const,
		code: "forbidden_marker" as const,
		message: "Forbidden output marker: —",
	};
	const rightDiagnostic = {
		kind: "final_product" as const,
		production_step: "main_story_copyedit" as const,
		code: "ungrounded_quote" as const,
		message: "Ungrounded quote: invented",
	};
	const compared = compareRuns(
		{ id: "left-observed", steps: [{ output: product }], diagnostics: [leftDiagnostic] },
		{ id: "right-observed", steps: [{ output: product }], diagnostics: [rightDiagnostic] },
	);

	expect(compared).toEqual({
		leftId: "left-observed",
		rightId: "right-observed",
		differences: ["run.diagnostics[0].code", "run.diagnostics[0].message"],
		leftDiagnostics: [leftDiagnostic],
		rightDiagnostics: [rightDiagnostic],
	});
	expect(formatRunComparison(compared)).toContain(
		"Left diagnostics: 1 observed\n- main_story_copyedit final_product/forbidden_marker",
	);
	expect(formatRunComparison(compared)).toContain(
		"Right diagnostics: 1 observed\n- main_story_copyedit final_product/ungrounded_quote",
	);

	const historicalUnknown = compareRuns(
		{ id: "left-observed", steps: [{ output: product }], diagnostics: [leftDiagnostic] },
		{ id: "right-unknown", steps: [{ output: product }] },
	);
	expect(historicalUnknown.differences).toEqual([]);
	expect(historicalUnknown.leftDiagnostics).toEqual([leftDiagnostic]);
	expect(Object.hasOwn(historicalUnknown, "rightDiagnostics")).toBe(false);
	expect(formatRunComparison(historicalUnknown)).toContain("Right diagnostics: unknown (not retained)");
});
