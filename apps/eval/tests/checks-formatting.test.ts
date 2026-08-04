import { expect, test } from "vitest";
import type { MainStoryOutput } from "@bc-news/generation-core";
import { parseMainStoryOutput } from "@bc-news/generation-core";
import { recordedModelProvider } from "@bc-news/fixtures";
import { formattingCheck } from "../src/checks/formatting";

function mainStoryOutput(body: string): MainStoryOutput {
	return {
		main_story: {
			headline: "Region roundup",
			lede: "What the day looked like in chat.",
			body,
		},
	};
}

test("flags an em dash in the body", () => {
	const output = mainStoryOutput("The muster began quietly — then all at once.");

	const result = formattingCheck(output, []);

	expect(result.name).toBe("formatting");
	expect(result.passed).toBe(false);
	expect(result.detail).toContain("Contains an em dash");
});

test("flags a markdown header in the body", () => {
	const output = mainStoryOutput("# Region Roundup\n\nThe day was busy across the chat.");

	const result = formattingCheck(output, []);

	expect(result.passed).toBe(false);
	expect(result.detail).toContain("Contains markdown headers");
});

test("flags bold formatting used on a number instead of a player name", () => {
	const output = mainStoryOutput("**42** players joined the muster this evening.");

	const result = formattingCheck(output, []);

	expect(result.passed).toBe(false);
	expect(result.detail).toContain("Bold used on number: 42");
});

test("passes a body that satisfies SYSTEM_CONSTRAINTS formatting", async () => {
	const { text } = await recordedModelProvider.complete({
		editorialCapability: "main_story",
		system: "",
		user: "",
	});
	const output = parseMainStoryOutput(text);

	const result = formattingCheck(output, []);

	expect(result.passed).toBe(true);
});
