import { expect, test } from "vitest";
import {
	buildAnnouncementsWriterPrompt,
	EditorialOutputContractError,
	parseAnnouncementsWriterOutput,
	type PreparedEvidence,
} from "../src/index";

const PREPARED_EVIDENCE: PreparedEvidence = {
	active_region_id: "7",
	publication_date: "2026-01-25",
	raw_count: 1,
	after_filter_count: 1,
	after_burst_count: 1,
	final_count: 1,
	drop_stats: { empty_after_trim: 0, too_short: 0, burst_merged: 0 },
	game_references: [{
		token: "[[GAME_REF_001]]",
		kind: "coord",
		northing: 3745,
		easting: 3857,
		display_text: "South Gate",
		destination_url: "https://bitcraftmap.com/?center=3745,3857&zoom=3.0",
	}],
	messages: [{
		id: "message-1",
		ts: 1_769_212_800_000,
		author_name: "KitServal",
		author_id: "kitserval",
		text: "reached level 50 in Fishing near [South Gate](coord=3745,3857)",
	}],
};

const ANNOUNCEMENTS = {
	announcements: [
		{
			title: "KitServal Reaches Level 50",
			summary: "**KitServal** reached level 50 in *Fishing* and called it \"a long haul\".",
		},
	],
};

const ANNOUNCEMENTS_WRITER_OUTPUT = {
	announcements: [{
		title: "**[[AUTHOR_001]]** Reaches Level 50",
		summary: "**[[AUTHOR_001]]** reached level 50 in *Fishing* and called it \"a long haul\".",
	}],
};

test("resolves author identities in announcements and keeps an empty product valid", () => {
	expect(
		parseAnnouncementsWriterOutput(
			JSON.stringify(ANNOUNCEMENTS_WRITER_OUTPUT),
			PREPARED_EVIDENCE,
		),
	).toEqual(ANNOUNCEMENTS);
	expect(
		parseAnnouncementsWriterOutput("{\"announcements\":[]}", PREPARED_EVIDENCE),
	).toEqual({ announcements: [] });
});

test("normalizes decoded CRLF sequences in announcement strings", () => {
	const parsed = parseAnnouncementsWriterOutput(JSON.stringify({
		announcements: [{
			title: "Bridge Crew Checks In\r\nAgain",
			summary: "First paragraph.\r\n\r\nSecond paragraph.",
		}],
	}), PREPARED_EVIDENCE);

	expect(parsed).toEqual({
		announcements: [{
			title: "Bridge Crew Checks In\nAgain",
			summary: "First paragraph.\n\nSecond paragraph.",
		}],
	});
});

test("preserves literal backslash escapes inside announcement summaries", () => {
	const parsed = parseAnnouncementsWriterOutput(
		"{\"announcements\":[{\"title\":\"Quiet Shift\",\"summary\":\"First line\\\\nSecond line\"}]}",
		PREPARED_EVIDENCE,
	);

	expect(parsed.announcements[0]?.summary).toBe("First line\\nSecond line");
});

test("teaches exact location-token reuse and resolves plain fields while retaining rich-field tokens", () => {
	const prompt = buildAnnouncementsWriterPrompt(PREPARED_EVIDENCE);
	expect(prompt).toContain("[GAME REFERENCES]");
	expect(prompt).toContain("- [[GAME_REF_001]]: coord=3745,3857");
	expect(prompt).toContain("including plain-text titles, headlines, and ledes");
	expect(prompt).toContain("[[AUTHOR_001]]: reached level 50 in Fishing near [[GAME_REF_001]]");

	const parsed = parseAnnouncementsWriterOutput(JSON.stringify({
		announcements: [{
			title: "Watch at [[GAME_REF_001]]",
			summary: "**[[AUTHOR_001]]** reached level 50 near [[GAME_REF_001]].",
		}],
	}), PREPARED_EVIDENCE);

	expect(parsed).toEqual({
		announcements: [{
			title: "Watch at South Gate",
			summary: "**KitServal** reached level 50 near [[GAME_REF_001]].",
		}],
	});
});

test("treats malformed JSON and null content as terminal contract failures", () => {
	expect(() => parseAnnouncementsWriterOutput("not json", PREPARED_EVIDENCE)).toThrow(
		EditorialOutputContractError,
	);
	const failure = (() => {
		try {
			parseAnnouncementsWriterOutput(null, PREPARED_EVIDENCE);
		} catch (error: unknown) {
			return error;
		}
		return undefined;
	})();

	expect(failure).toMatchObject({
		name: "EditorialOutputContractError",
		productionStep: "announcements_write",
		code: "contract_mismatch",
	});
});

test("rejects unknown announcement keys at the writer boundary", () => {
	expect(() => parseAnnouncementsWriterOutput(JSON.stringify({
		announcements: [{
			title: "Bridge Crew Checks In",
			summary: "Still moving.",
			id: "legacy",
		}],
	}), PREPARED_EVIDENCE)).toThrow(EditorialOutputContractError);
});

test("rejects invalid author identity tokens in announcement fields", () => {
	for (const summary of [
		"[[AUTHOR_999]] reached level 50.",
		"**[[AUTHOR_999]]** reached level 50.",
		"AUTHOR_001 reached level 50.",
		"*[[AUTHOR_001]]* reached level 50.",
		"**[[AUTHOR_001]]* reached level 50.",
		"**[[AUTHOR_001]] reached level 50.",
		"[[AUTHOR_001]]** reached level 50.",
		"***[[AUTHOR_001]]*** reached level 50.",
	]) {
		expect(() => parseAnnouncementsWriterOutput(JSON.stringify({
			announcements: [{ title: "Skill milestone", summary }],
		}), PREPARED_EVIDENCE)).toThrow(EditorialOutputContractError);
	}
});

test("rejects raw coordinate syntax in plain and rich announcement fields", () => {
	expect(() => parseAnnouncementsWriterOutput(JSON.stringify({
		announcements: [{
			title: "Watch at (coord=3745,3857)",
			summary: "**[[AUTHOR_001]]** reached level 50 near [South Gate](coord=3745,3857).",
		}],
	}), PREPARED_EVIDENCE)).toThrow(EditorialOutputContractError);
	expect(() => parseAnnouncementsWriterOutput(JSON.stringify({
		announcements: [{
			title: "Watch at N 3745, E 3857",
			summary: "**[[AUTHOR_001]]** reached level 50.",
		}],
	}), PREPARED_EVIDENCE)).toThrow(EditorialOutputContractError);
});

test("rejects invalid game reference tokens in announcement fields", () => {
	for (const summary of [
		"[[GAME_REF_999]] reached level 50.",
		"GAME_REF_001 reached level 50.",
		"**[[GAME_REF_001]]** reached level 50.",
		"[South Gate]([[GAME_REF_001]]) reached level 50.",
	]) {
		expect(() => parseAnnouncementsWriterOutput(JSON.stringify({
			announcements: [{ title: "Skill milestone", summary }],
		}), PREPARED_EVIDENCE)).toThrow(EditorialOutputContractError);
	}
});
