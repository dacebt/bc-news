import {
	COPYEDIT_SYSTEM_CONSTRAINTS,
	WRITER_SYSTEM_CONSTRAINTS,
	attachAnnouncementIds,
	buildAnnouncementsCopyeditPrompt,
	buildAnnouncementsWriterPrompt,
	buildMainStoryCopyeditPrompt,
	buildMainStoryWriterPrompt,
} from "@bc-news/generation-core";
import { expect, test } from "vitest";
import {
	V3_COPYEDIT_SYSTEM_CONSTRAINTS,
	buildV3CopyeditPrompt,
	parseV3Completion,
} from "../src/evaluation-artifact-v3-parser";
import {
	V3_WRITER_SYSTEM_CONSTRAINTS,
	buildV3WriterPrompt,
} from "../src/evaluation-artifact-v3-writer-prompts";

const EVIDENCE = {
	active_region_id: "7",
	publication_date: "2026-01-25",
	raw_count: 1,
	after_filter_count: 1,
	after_burst_count: 1,
	final_count: 1,
	drop_stats: {
		empty_after_trim: 0,
		too_short: 0,
		burst_merged: 0,
		sampling_dropped: 0,
	},
	messages: [{
		id: "m1",
		ts: Date.UTC(2026, 0, 24, 12),
		author_id: "author-1",
		author_name: "Aryn",
		text: "Ready for the dungeon run.",
	}],
};

const MAIN_STORY = {
	title: "Regional Chronicle",
	subtitle: "Dungeon preparations continue",
	main_story: {
		headline: "Aryn Organizes a Dungeon Muster",
		lede: "The region prepared for a dungeon run.",
		body: "**Aryn** organized the group.\n\nThe party prepared.\n\n",
	},
};

const ANNOUNCEMENTS = {
	announcements: [{
		title: "Dungeon Muster Organized",
		summary: "**Aryn** organized the group.",
	}],
};

test("artifact version 3 freezes its historical request contract", () => {
	expect(V3_WRITER_SYSTEM_CONSTRAINTS).not.toBe(WRITER_SYSTEM_CONSTRAINTS);
	expect(V3_WRITER_SYSTEM_CONSTRAINTS).not.toContain("[POINT OF VIEW]");
	expect(WRITER_SYSTEM_CONSTRAINTS).toContain("[POINT OF VIEW]");
	expect(V3_COPYEDIT_SYSTEM_CONSTRAINTS).toBe(COPYEDIT_SYSTEM_CONSTRAINTS);
	expect(buildV3WriterPrompt("main_story", EVIDENCE)).toContain("Cover every substantive discussion");
	expect(buildMainStoryWriterPrompt(EVIDENCE)).toContain("[STORY OF THE DAY]");
	expect(buildV3WriterPrompt("announcements", EVIDENCE)).toBe(
		buildAnnouncementsWriterPrompt(EVIDENCE),
	);
	expect(buildV3CopyeditPrompt("main_story", MAIN_STORY)).toBe(buildMainStoryCopyeditPrompt(MAIN_STORY));
	expect(buildV3CopyeditPrompt("announcements", ANNOUNCEMENTS)).toBe(
		buildAnnouncementsCopyeditPrompt(attachAnnouncementIds(ANNOUNCEMENTS)),
	);
});

test("artifact version 3 preserves trailing-separator normalization", () => {
	const edited = {
		...MAIN_STORY,
		main_story: {
			...MAIN_STORY.main_story,
			body: MAIN_STORY.main_story.body.trimEnd(),
		},
	};

	expect(parseV3Completion(
		"main_story_copyedit",
		JSON.stringify(edited),
		MAIN_STORY,
	)).toEqual(edited);
});
