import { expect, test } from "vitest";
import {
	EditorialOutputContractError,
	parseMainStoryWriterOutput,
	type PreparedEvidence,
} from "../src/index";

const PREPARED_EVIDENCE: PreparedEvidence = {
	active_region_id: "7",
	publication_date: "2026-01-25",
	raw_count: 1,
	after_filter_count: 1,
	after_burst_count: 1,
	final_count: 1,
	drop_stats: { empty_after_trim: 0, too_short: 0, burst_merged: 0, sampling_dropped: 0 },
	messages: [{
		id: "message-1",
		ts: 1_769_212_800_000,
		author_name: "Mira",
		author_id: "mira",
		text: "forge is finally behaving today",
	}],
};

const ORDINARY_STORY = {
	title: "A Brief Word at the Forge",
	main_story: {
		headline: "Smiths Pause to Compare Notes",
		lede: "A short exchange at the forge still produced a story once the region slowed down enough to listen.",
		body: "**Mira** remarked, \"forge is finally behaving today,\" and the room settled into practical talk about getting work done.",
	},
};

const ORDINARY_WRITER_OUTPUT = {
	...ORDINARY_STORY,
	main_story: {
		...ORDINARY_STORY.main_story,
		body: "[[AUTHOR_001]] remarked, \"forge is finally behaving today,\" and the room settled into practical talk about getting work done.",
	},
};

test("resolves code-owned author identities with field-appropriate formatting", () => {
	const writerOutput = {
		...ORDINARY_WRITER_OUTPUT,
		title: "Notes from **[[AUTHOR_001]]**",
		main_story: {
			...ORDINARY_WRITER_OUTPUT.main_story,
			headline: "[[AUTHOR_001]] Pauses to Compare Notes",
			lede: "[[AUTHOR_001]] found the forge behaving for once.",
			body: "**[[AUTHOR_001]]** remarked, \"forge is finally behaving today,\" and the room settled into practical talk about getting work done.",
		},
	};

	expect(
		parseMainStoryWriterOutput(JSON.stringify(writerOutput), PREPARED_EVIDENCE),
	).toEqual({
		title: "Notes from Mira",
		main_story: {
			headline: "Mira Pauses to Compare Notes",
			lede: "Mira found the forge behaving for once.",
			body: ORDINARY_STORY.main_story.body,
		},
	});
});

test("normalizes decoded CRLF paragraph breaks before returning the writer product", () => {
	const parsed = parseMainStoryWriterOutput(JSON.stringify({
		...ORDINARY_WRITER_OUTPUT,
		main_story: {
			...ORDINARY_WRITER_OUTPUT.main_story,
			body: "First paragraph.\r\n\r\nSecond paragraph.",
		},
	}), PREPARED_EVIDENCE);

	expect(parsed.main_story.body).toBe("First paragraph.\n\nSecond paragraph.");
});

test("preserves literal backslash escapes instead of interpreting them during normalization", () => {
	const parsed = parseMainStoryWriterOutput(
		"{\"title\":\"Quiet Night\",\"main_story\":{\"headline\":\"Lanterns Stayed Lit\",\"lede\":\"Nothing much broke.\",\"body\":\"First line\\\\nSecond line\"}}",
		PREPARED_EVIDENCE,
	);

	expect(parsed.main_story.body).toBe("First line\\nSecond line");
});

test("rejects fenced output instead of coercing it", () => {
	const fenced = `\`\`\`json\n${JSON.stringify(ORDINARY_WRITER_OUTPUT)}\n\`\`\``;

	expect(() => parseMainStoryWriterOutput(fenced, PREPARED_EVIDENCE)).toThrow(
		EditorialOutputContractError,
	);
});

test("classifies null content as a strict contract mismatch", () => {
	const failure = (() => {
		try {
			parseMainStoryWriterOutput(null, PREPARED_EVIDENCE);
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
		...ORDINARY_WRITER_OUTPUT,
		subtitle: "legacy",
	}), PREPARED_EVIDENCE)).toThrow(EditorialOutputContractError);
	expect(() => parseMainStoryWriterOutput(JSON.stringify({
		...ORDINARY_WRITER_OUTPUT,
		main_story: {
			...ORDINARY_WRITER_OUTPUT.main_story,
			image: { url: "https://example.test/image.png", caption: "legacy" },
		},
	}), PREPARED_EVIDENCE)).toThrow(EditorialOutputContractError);
});

test("rejects unknown and malformed author identity tokens", () => {
	for (const body of [
		"[[AUTHOR_999]] reported from the forge.",
		"**[[AUTHOR_999]]** reported from the forge.",
		"AUTHOR_001 reported from the forge.",
		"*[[AUTHOR_001]]* reported from the forge.",
		"**[[AUTHOR_001]]* reported from the forge.",
		"**[[AUTHOR_001]] reported from the forge.",
		"[[AUTHOR_001]]** reported from the forge.",
		"***[[AUTHOR_001]]*** reported from the forge.",
	]) {
		expect(() => parseMainStoryWriterOutput(JSON.stringify({
			...ORDINARY_WRITER_OUTPUT,
			main_story: { ...ORDINARY_WRITER_OUTPUT.main_story, body },
		}), PREPARED_EVIDENCE)).toThrow(EditorialOutputContractError);
	}
});

test("renders the latest known display name and escapes its markdown controls", () => {
	const evidence: PreparedEvidence = {
		...PREPARED_EVIDENCE,
		raw_count: 2,
		after_filter_count: 2,
		after_burst_count: 2,
		final_count: 2,
		messages: [
			PREPARED_EVIDENCE.messages[0]!,
			{
				...PREPARED_EVIDENCE.messages[0]!,
				id: "message-2",
				ts: 1_769_212_800_001,
				author_name: "Mira_[North]",
			},
		],
	};
	const parsed = parseMainStoryWriterOutput(JSON.stringify({
		...ORDINARY_WRITER_OUTPUT,
		title: "News from [[AUTHOR_001]]",
		main_story: {
			...ORDINARY_WRITER_OUTPUT.main_story,
			body: "[[AUTHOR_001]] reported from the forge.",
		},
	}), evidence);

	expect(parsed.title).toBe("News from Mira_[North]");
	expect(parsed.main_story.body).toBe("**Mira\\_\\[North\\]** reported from the forge.");
});
