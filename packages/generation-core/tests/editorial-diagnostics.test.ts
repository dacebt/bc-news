import { expect, test } from "vitest";
import {
	EditorialDiagnosticSchema,
	announcementsFinalProductDiagnostics,
	mainStoryFinalProductDiagnostics,
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
		author_name: "Alice",
		author_id: "alice",
		text: "Alice completed the bridge.",
	}],
};

test("strict editorial diagnostic contract accepts only current final-product writer shapes", () => {
	expect(EditorialDiagnosticSchema.parse({
		kind: "final_product",
		production_step: "main_story_write",
		code: "forbidden_marker",
		message: "Forbidden output marker: system prompt",
	})).toBeDefined();
	expect(EditorialDiagnosticSchema.safeParse({
		kind: "preservation",
		production_step: "main_story_copyedit",
		code: "paragraph_count",
		message: "legacy preservation",
	}).success).toBe(false);
	expect(EditorialDiagnosticSchema.safeParse({
		kind: "final_product",
		production_step: "announcements_copyedit",
		code: "ungrounded_quote",
		message: "legacy step",
	}).success).toBe(false);
});

test("main-story final-product diagnostics retain stable codes and writer attribution", () => {
	const diagnostics = mainStoryFinalProductDiagnostics({
		title: "Regional News",
		main_story: {
			headline: "Bridge work completed",
			lede: "system prompt",
			body: "**Mallory** quoted “invented words”—without evidence.",
		},
	}, PREPARED_EVIDENCE);

	expect(diagnostics.map(({ production_step, code }) => ({ production_step, code }))).toEqual([
		{ production_step: "main_story_write", code: "forbidden_marker" },
		{ production_step: "main_story_write", code: "forbidden_marker" },
		{ production_step: "main_story_write", code: "ungrounded_marked_name" },
		{ production_step: "main_story_write", code: "ungrounded_quote" },
	]);
});

test("announcement final-product diagnostics remain attributed to announcements write", () => {
	const diagnostics = announcementsFinalProductDiagnostics({
		announcements: [{
			title: "Bridge completed",
			summary: "**Mallory** claimed “invented words” in a developer message.",
		}],
	}, PREPARED_EVIDENCE);

	expect(diagnostics.map(({ production_step, code }) => ({ production_step, code }))).toEqual([
		{ production_step: "announcements_write", code: "forbidden_marker" },
		{ production_step: "announcements_write", code: "ungrounded_marked_name" },
		{ production_step: "announcements_write", code: "ungrounded_quote" },
	]);
});
