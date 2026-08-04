import { expect, test } from "vitest";
import { EditorialOutputContractError, parseMainStoryOutput } from "../src/main-story";

test("rejects fenced model output", () => {
	const fenced = [
		"```json",
		JSON.stringify({ main_story: { headline: "h", lede: "l", body: "b" } }),
		"```",
	].join("\n");

	expect(() => parseMainStoryOutput(fenced)).toThrow(EditorialOutputContractError);
	expect(() => parseMainStoryOutput(fenced)).toThrow("not valid JSON");
});
