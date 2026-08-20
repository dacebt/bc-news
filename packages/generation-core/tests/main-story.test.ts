import { expect, test } from "vitest";
import {
	EditorialOutputContractError,
	parseMainStoryWriterOutput,
} from "../src/index";

const ORDINARY_STORY = {
	title: "A Brief Word at the Forge",
	main_story: {
		headline: "Smiths Pause to Compare Notes",
		lede: "A short exchange at the forge still produced a story once the region slowed down enough to listen.",
		body: "**Mira** remarked, \"forge is finally behaving today,\" and the room settled into practical talk about getting work done.",
	},
};

test("accepts the current writer shape for an ordinary in-world story", () => {
	expect(parseMainStoryWriterOutput(JSON.stringify(ORDINARY_STORY))).toEqual(ORDINARY_STORY);
});

test("normalizes decoded CRLF paragraph breaks before returning the writer product", () => {
	const parsed = parseMainStoryWriterOutput(JSON.stringify({
		...ORDINARY_STORY,
		main_story: {
			...ORDINARY_STORY.main_story,
			body: "First paragraph.\r\n\r\nSecond paragraph.",
		},
	}));

	expect(parsed.main_story.body).toBe("First paragraph.\n\nSecond paragraph.");
});

test("preserves literal backslash escapes instead of interpreting them during normalization", () => {
	const parsed = parseMainStoryWriterOutput("{\"title\":\"Quiet Night\",\"main_story\":{\"headline\":\"Lanterns Stayed Lit\",\"lede\":\"Nothing much broke.\",\"body\":\"First line\\\\nSecond line\"}}");

	expect(parsed.main_story.body).toBe("First line\\nSecond line");
});

test("rejects fenced output instead of coercing it", () => {
	const fenced = `\`\`\`json\n${JSON.stringify(ORDINARY_STORY)}\n\`\`\``;

	expect(() => parseMainStoryWriterOutput(fenced)).toThrow(EditorialOutputContractError);
});

test("classifies null content as a strict contract mismatch", () => {
	const failure = (() => {
		try {
			parseMainStoryWriterOutput(null);
		} catch (error: unknown) {
			return error;
		}
		return undefined;
	})();

	expect(failure).toMatchObject({
		name: "EditorialOutputContractError",
		productionStep: "main_story_write",
		code: "contract_mismatch",
	});
});

test("rejects legacy-only fields and unknown keys at the writer boundary", () => {
	expect(() => parseMainStoryWriterOutput(JSON.stringify({
		...ORDINARY_STORY,
		subtitle: "legacy",
	}))).toThrow(EditorialOutputContractError);
	expect(() => parseMainStoryWriterOutput(JSON.stringify({
		...ORDINARY_STORY,
		main_story: {
			...ORDINARY_STORY.main_story,
			image: { url: "https://example.test/image.png", caption: "legacy" },
		},
	}))).toThrow(EditorialOutputContractError);
});
