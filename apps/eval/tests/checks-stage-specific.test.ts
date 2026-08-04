import { expect, test } from "vitest";
import type { MainStoryOutput } from "@bc-news/generation-core";
import { parseMainStoryOutput } from "@bc-news/generation-core";
import { recordedModelProvider } from "@bc-news/fixtures";
import { mainStoryStageSpecificCheck } from "../src/checks/main-story-checks";

test("flags a single-paragraph main_story body as underdeveloped", () => {
	const output: MainStoryOutput = {
		main_story: {
			headline: "Region roundup",
			lede: "What the day looked like in chat.",
			body: "Aryn organized a dungeon run today and the region turned out for it.",
		},
	};

	const result = mainStoryStageSpecificCheck(output);

	expect(result.name).toBe("stage_specific");
	expect(result.passed).toBe(false);
	expect(result.detail).toContain("Single paragraph lacks narrative development");
});

test("passes a multi-paragraph narrative with varied structure and grounded detail", async () => {
	const { text } = await recordedModelProvider.complete({
		editorialCapability: "main_story",
		system: "",
		user: "",
	});
	const output = parseMainStoryOutput(text);

	const result = mainStoryStageSpecificCheck(output);

	expect(result.passed).toBe(true);
});
