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

test("strict editorial diagnostic contract accepts only stable preservation and final-product shapes", () => {
	expect(EditorialDiagnosticSchema.parse({
		kind: "preservation",
		production_step: "main_story_copyedit",
		code: "paragraph_count",
		message: "Copyedit changed paragraph count in main_story.body",
	})).toBeDefined();
	expect(EditorialDiagnosticSchema.parse({
		kind: "final_product",
		production_step: "announcements_copyedit",
		code: "ungrounded_quote",
		message: "Ungrounded quote: invented words",
	})).toBeDefined();
	expect(EditorialDiagnosticSchema.safeParse({
		kind: "final_product",
		production_step: "announcements_copyedit",
		code: "paragraph_count",
		message: "cross-kind code",
	}).success).toBe(false);
	expect(EditorialDiagnosticSchema.safeParse({
		kind: "preservation",
		production_step: "main_story_copyedit",
		code: "paragraph_count",
		message: "extra key",
		path: "main_story.body",
	}).success).toBe(false);
});

test("main-story final-product diagnostics retain stable codes and deterministic order", () => {
	const diagnostics = mainStoryFinalProductDiagnostics({
		title: "Regional News",
		subtitle: "Work continued",
		main_story: {
			headline: "Bridge work completed",
			lede: "system prompt",
			body: "**Mallory** quoted “invented words”—without evidence.",
		},
	}, PREPARED_EVIDENCE);

	expect(diagnostics.map(({ code }) => code)).toEqual([
		"forbidden_marker",
		"forbidden_marker",
		"ungrounded_marked_name",
		"ungrounded_quote",
	]);
	expect(diagnostics.map(({ message }) => message)).toEqual([
		"Forbidden output marker: system prompt",
		"Forbidden output marker: —",
		"Ungrounded marked name: Mallory",
		"Ungrounded quote: invented words",
	]);
});

test("announcement final-product diagnostics remain attributed to announcements copyedit", () => {
	const diagnostics = announcementsFinalProductDiagnostics({
		announcements: [{
			title: "Bridge completed",
			summary: "**Mallory** claimed “invented words” in a developer message.",
		}],
	}, PREPARED_EVIDENCE);

	expect(diagnostics.map(({ production_step, code }) => ({ production_step, code }))).toEqual([
		{ production_step: "announcements_copyedit", code: "forbidden_marker" },
		{ production_step: "announcements_copyedit", code: "ungrounded_marked_name" },
		{ production_step: "announcements_copyedit", code: "ungrounded_quote" },
	]);
});
