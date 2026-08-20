import { expect, test } from "vitest";
import {
	EditorialOutputContractError,
	parseAnnouncementsWriterOutput,
} from "../src/index";

const ANNOUNCEMENTS = {
	announcements: [
		{
			title: "KitServal Reaches Level 50",
			summary: "**KitServal** reached level 50 in *Fishing* and called it \"a long haul\".",
		},
	],
};

test("accepts evidence-grounded announcements and keeps an empty product valid", () => {
	expect(parseAnnouncementsWriterOutput(JSON.stringify(ANNOUNCEMENTS))).toEqual(ANNOUNCEMENTS);
	expect(parseAnnouncementsWriterOutput("{\"announcements\":[]}")).toEqual({ announcements: [] });
});

test("normalizes decoded CRLF sequences in announcement strings", () => {
	const parsed = parseAnnouncementsWriterOutput(JSON.stringify({
		announcements: [{
			title: "Bridge Crew Checks In\r\nAgain",
			summary: "First paragraph.\r\n\r\nSecond paragraph.",
		}],
	}));

	expect(parsed).toEqual({
		announcements: [{
			title: "Bridge Crew Checks In\nAgain",
			summary: "First paragraph.\n\nSecond paragraph.",
		}],
	});
});

test("preserves literal backslash escapes inside announcement summaries", () => {
	const parsed = parseAnnouncementsWriterOutput("{\"announcements\":[{\"title\":\"Quiet Shift\",\"summary\":\"First line\\\\nSecond line\"}]}");

	expect(parsed.announcements[0]?.summary).toBe("First line\\nSecond line");
});

test("treats malformed JSON and null content as terminal contract failures", () => {
	expect(() => parseAnnouncementsWriterOutput("not json")).toThrow(EditorialOutputContractError);
	const failure = (() => {
		try {
			parseAnnouncementsWriterOutput(null);
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
	}))).toThrow(EditorialOutputContractError);
});
