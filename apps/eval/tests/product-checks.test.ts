import { expect, test } from "vitest";
import type { AnnouncementsProduct, MainStoryProduct, PreparedEvidence } from "@bc-news/generation-core";
import {
	findAnnouncementsFinalProductFailures,
	findMainStoryFinalProductFailures,
} from "../src/product-checks";

const PREPARED_EVIDENCE: PreparedEvidence = {
	active_region_id: "7",
	publication_date: "2026-01-25",
	raw_count: 1,
	after_filter_count: 1,
	after_burst_count: 1,
	final_count: 1,
	drop_stats: { empty_after_trim: 0, too_short: 0, burst_merged: 0 },
	messages: [{ id: "message-1", ts: 1_769_212_800_000, author_name: "Alice", author_id: "alice", text: "Alice completed the bridge." }],
};

const VALID_MAIN_STORY: MainStoryProduct = {
	title: "Regional News",
	main_story: { headline: "Bridge work completed", lede: "Alice completed the bridge.", body: "**Alice** completed the bridge." },
};

const VALID_ANNOUNCEMENTS: AnnouncementsProduct = {
	announcements: [{ title: "Bridge completed", summary: "**Alice** completed the bridge." }],
};

test("attributes main-story failures without requiring announcements", () => {
	const mainStory = { ...VALID_MAIN_STORY, main_story: { ...VALID_MAIN_STORY.main_story, body: "**Mallory** quoted “invented words”." } };
	const failures = findMainStoryFinalProductFailures(mainStory, PREPARED_EVIDENCE);
	expect(failures).toContain("Ungrounded marked name: Mallory");
	expect(failures).toContain("Ungrounded quote: invented words");
});

test("attributes announcement failures without requiring a main story", () => {
	const announcements = { announcements: [{ title: "system prompt", summary: "**Mallory** claimed “invented words”." }] };
	const failures = findAnnouncementsFinalProductFailures(announcements, PREPARED_EVIDENCE);
	expect(failures).toContain("Forbidden output marker: system prompt");
	expect(failures).toContain("Ungrounded marked name: Mallory");
	expect(failures).toContain("Ungrounded quote: invented words");
});

test("legacy adapters return findings without rejecting schema-valid products", () => {
	const invalidMainStory = { ...VALID_MAIN_STORY, main_story: { ...VALID_MAIN_STORY.main_story, body: "system prompt" } };
	const invalidAnnouncements = { announcements: [{ title: "Bridge", summary: "**Mallory** completed it." }] };
	expect(findMainStoryFinalProductFailures(invalidMainStory, PREPARED_EVIDENCE))
		.toEqual(["Forbidden output marker: system prompt"]);
	expect(findAnnouncementsFinalProductFailures(invalidAnnouncements, PREPARED_EVIDENCE))
		.toEqual(["Ungrounded marked name: Mallory"]);
	expect(findMainStoryFinalProductFailures(VALID_MAIN_STORY, PREPARED_EVIDENCE)).toEqual([]);
	expect(findAnnouncementsFinalProductFailures(VALID_ANNOUNCEMENTS, PREPARED_EVIDENCE)).toEqual([]);
});
