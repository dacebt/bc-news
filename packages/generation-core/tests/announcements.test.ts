import { expect, test } from "vitest";
import { buildAnnouncementsPrompt, parseAnnouncementsOutput } from "../src/announcements";
import { EditorialOutputContractError } from "../src/main-story";

test("rejects non-json model output", () => {
	expect(() => parseAnnouncementsOutput("not json")).toThrow(EditorialOutputContractError);
	try {
		parseAnnouncementsOutput("not json");
		expect.unreachable("parseAnnouncementsOutput should have thrown");
	} catch (error) {
		expect(error).toBeInstanceOf(EditorialOutputContractError);
		expect((error as EditorialOutputContractError).code).toBe("invalid_json");
	}
});

test("rejects json missing the announcements key", () => {
	const text = JSON.stringify({ items: [] });
	try {
		parseAnnouncementsOutput(text);
		expect.unreachable("parseAnnouncementsOutput should have thrown");
	} catch (error) {
		expect(error).toBeInstanceOf(EditorialOutputContractError);
		expect((error as EditorialOutputContractError).code).toBe("contract_mismatch");
	}
});

test("rejects an announcement with an empty title", () => {
	const text = JSON.stringify({
		announcements: [{ title: "", summary: "Something happened." }],
	});

	expect(() => parseAnnouncementsOutput(text)).toThrow(EditorialOutputContractError);
	expect(() => parseAnnouncementsOutput(text)).toThrow("contract");
});

test("rejects an announcement with an empty summary", () => {
	const text = JSON.stringify({
		announcements: [{ title: "A title", summary: "" }],
	});

	expect(() => parseAnnouncementsOutput(text)).toThrow(EditorialOutputContractError);
});

test("rejects an announcement with an extra key", () => {
	const text = JSON.stringify({
		announcements: [{ title: "A title", summary: "A summary", tier: 7 }],
	});

	expect(() => parseAnnouncementsOutput(text)).toThrow(EditorialOutputContractError);
});

test("accepts an empty announcements array for a quiet region", () => {
	const text = JSON.stringify({ announcements: [] });

	expect(parseAnnouncementsOutput(text)).toEqual({ announcements: [] });
});

test("built prompt contains the exact open and close fence markers exactly once", () => {
	const fenceStart = "[UNTRUSTED CHAT MESSAGE DATA]";
	const fenceEnd = "[END UNTRUSTED CHAT MESSAGE DATA]";
	const prompt = buildAnnouncementsPrompt({
		active_region_id: "7",
		publication_date: "2026-01-25",
		raw_count: 1,
		after_filter_count: 1,
		after_burst_count: 1,
		final_count: 1,
		drop_stats: { empty_after_trim: 0, too_short: 0, burst_merged: 0 },
		messages: [
			{
				id: "m1",
				ts: Date.UTC(2026, 0, 24, 12, 0, 0),
				author_id: "en/Regular",
				author_name: "Regular",
				text: "hit level 40 fishing today",
			},
		],
	});

	expect(prompt.split(fenceStart).length - 1).toBe(1);
	expect(prompt.split(fenceEnd).length - 1).toBe(1);
});
