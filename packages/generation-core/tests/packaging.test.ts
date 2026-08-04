import { expect, test } from "vitest";
import { EditorialOutputContractError } from "../src/main-story";
import { buildPackagingPrompt, parsePackagingOutput } from "../src/packaging";

const SAMPLE_MAIN_STORY = {
	main_story: {
		headline: "Region Talks Fishing All Day",
		lede: "A quiet day of chat centered on skill grinding.",
		body: "**Regular** hit level 40 fishing today.",
	},
};

const SAMPLE_ANNOUNCEMENTS = {
	announcements: [
		{ title: "Regular Hits Fishing 40", summary: "**Regular** hit level 40 fishing today." },
	],
};

const SAMPLE_CONTEXT = { activeRegionId: "7", publicationDate: "2026-01-25" };

test("rejects non-json model output", () => {
	expect(() => parsePackagingOutput("not json")).toThrow(EditorialOutputContractError);
	try {
		parsePackagingOutput("not json");
		expect.unreachable("parsePackagingOutput should have thrown");
	} catch (error) {
		expect(error).toBeInstanceOf(EditorialOutputContractError);
		expect((error as EditorialOutputContractError).code).toBe("invalid_json");
	}
});

test("rejects json missing the title key", () => {
	const text = JSON.stringify({ subtitle: "A subtitle" });
	try {
		parsePackagingOutput(text);
		expect.unreachable("parsePackagingOutput should have thrown");
	} catch (error) {
		expect(error).toBeInstanceOf(EditorialOutputContractError);
		expect((error as EditorialOutputContractError).code).toBe("contract_mismatch");
	}
});

test("rejects an empty title", () => {
	const text = JSON.stringify({ title: "", subtitle: "A subtitle" });
	expect(() => parsePackagingOutput(text)).toThrow(EditorialOutputContractError);
});

test("rejects an empty subtitle", () => {
	const text = JSON.stringify({ title: "A title", subtitle: "" });
	expect(() => parsePackagingOutput(text)).toThrow(EditorialOutputContractError);
});

test("rejects output with an extra key", () => {
	const text = JSON.stringify({ title: "A title", subtitle: "A subtitle", region_id: "7" });
	expect(() => parsePackagingOutput(text)).toThrow(EditorialOutputContractError);
});

test("accepts a valid title and subtitle", () => {
	const text = JSON.stringify({ title: "The Eastern Gazette", subtitle: "January 25, 2026" });
	expect(parsePackagingOutput(text)).toEqual({
		title: "The Eastern Gazette",
		subtitle: "January 25, 2026",
	});
});

test("built prompt fences both stage outputs and carries their content", () => {
	const prompt = buildPackagingPrompt(SAMPLE_MAIN_STORY, SAMPLE_ANNOUNCEMENTS, SAMPLE_CONTEXT);

	expect(prompt).toContain("[UNTRUSTED ANNOUNCEMENTS DATA]");
	expect(prompt).toContain("[END UNTRUSTED ANNOUNCEMENTS DATA]");
	expect(prompt).toContain("[UNTRUSTED MAIN STORY DATA]");
	expect(prompt).toContain("[END UNTRUSTED MAIN STORY DATA]");
	expect(prompt).toContain(SAMPLE_MAIN_STORY.main_story.headline);
	expect(prompt).toContain(SAMPLE_ANNOUNCEMENTS.announcements[0]?.title);
});

test("built prompt carries no prepared-evidence transcript content", () => {
	const prompt = buildPackagingPrompt(SAMPLE_MAIN_STORY, SAMPLE_ANNOUNCEMENTS, SAMPLE_CONTEXT);

	expect(prompt).not.toContain("[UNTRUSTED CHAT MESSAGE DATA]");
	expect(prompt).not.toContain("[CHAT MESSAGES]");
});

test("built prompt carries the region and publication date exactly once each, outside the fences", () => {
	const prompt = buildPackagingPrompt(SAMPLE_MAIN_STORY, SAMPLE_ANNOUNCEMENTS, SAMPLE_CONTEXT);

	const regionLine = `Region: ${SAMPLE_CONTEXT.activeRegionId}`;
	const dateLine = `Date: ${SAMPLE_CONTEXT.publicationDate}`;
	expect(prompt.split(regionLine)).toHaveLength(2);
	expect(prompt.split(dateLine)).toHaveLength(2);

	const regionLineIndex = prompt.indexOf(regionLine);
	const dateLineIndex = prompt.indexOf(dateLine);
	const announcementsFenceStart = prompt.indexOf("[UNTRUSTED ANNOUNCEMENTS DATA]");
	const mainStoryFenceStart = prompt.indexOf("[UNTRUSTED MAIN STORY DATA]");

	expect(regionLineIndex).toBeGreaterThanOrEqual(0);
	expect(dateLineIndex).toBeGreaterThanOrEqual(0);
	expect(regionLineIndex).toBeLessThan(announcementsFenceStart);
	expect(regionLineIndex).toBeLessThan(mainStoryFenceStart);
	expect(dateLineIndex).toBeLessThan(announcementsFenceStart);
	expect(dateLineIndex).toBeLessThan(mainStoryFenceStart);
});

test("built prompt does not carry the stale hard-coded evidence-date example", () => {
	const prompt = buildPackagingPrompt(SAMPLE_MAIN_STORY, SAMPLE_ANNOUNCEMENTS, SAMPLE_CONTEXT);

	expect(prompt).not.toContain("January 24, 2026");
});
