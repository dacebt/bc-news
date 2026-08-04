import { expect, test } from "vitest";
import type { MainStoryOutput, PreparedMessage } from "@bc-news/generation-core";
import { groundingCheck } from "../src/checks/grounding";

// Copied verbatim from packages/fixtures/evidence/active-region-7_2026-01-24.json
const chickenBakeMessage: PreparedMessage = {
	id: "504403158437065750",
	ts: 1769214417000,
	author_id: "en/ChickenBake",
	author_name: "ChickenBake",
	text: "350k forestry at sages of the mines",
};

function mainStoryOutput(body: string): MainStoryOutput {
	return {
		main_story: {
			headline: "Region roundup",
			lede: "What the day looked like in chat.",
			body,
		},
	};
}

test("flags a quote that never appeared in the source messages", () => {
	const output = mainStoryOutput(
		'**ChickenBake** claimed, "we should abandon the settlement by dawn tomorrow" during the discussion.',
	);

	const result = groundingCheck(output, [chickenBakeMessage]);

	expect(result.name).toBe("grounding");
	expect(result.passed).toBe(false);
	expect(result.detail).toContain("Fabricated quote");
});

test("passes a quote taken directly from a source message", () => {
	const output = mainStoryOutput(
		'**ChickenBake** posted "350k forestry at sages of the mines" in chat.',
	);

	const result = groundingCheck(output, [chickenBakeMessage]);

	expect(result.passed).toBe(true);
	expect(result.detail).toBe("Marked text, quotes, and percentages are grounded");
});
