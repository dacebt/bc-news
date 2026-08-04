import { expect, test } from "vitest";
import type { EvidenceMessage } from "@bc-news/contracts";
import { prepareEvidence } from "../src/prepare-evidence";

const HOUR_START = Date.UTC(2026, 0, 24, 14, 0, 0, 0);

function sampleEvidence(): EvidenceMessage[] {
	const crowd: EvidenceMessage[] = Array.from({ length: 15 }, (_, index) => ({
		id: `crowd-${String(index).padStart(2, "0")}`,
		ts: HOUR_START + index * 60_000,
		author_id: `en/Author${index}`,
		author_name: `Author${index}`,
		text: `Message number ${index} about the day's trading`,
	}));
	const burst: EvidenceMessage[] = [
		{
			id: "burst-1",
			ts: Date.UTC(2026, 0, 24, 9, 0, 0, 0),
			author_id: "en/Bursty",
			author_name: "Bursty",
			text: "First half of a thought",
		},
		{
			id: "burst-2",
			ts: Date.UTC(2026, 0, 24, 9, 0, 20, 0),
			author_id: "en/Bursty",
			author_name: "Bursty",
			text: "second half twenty seconds later",
		},
	];
	const tie: EvidenceMessage[] = [
		{
			id: "tie-b",
			ts: Date.UTC(2026, 0, 24, 10, 0, 0, 0),
			author_id: "en/TieTwo",
			author_name: "TieTwo",
			text: "Same timestamp, later id",
		},
		{
			id: "tie-a",
			ts: Date.UTC(2026, 0, 24, 10, 0, 0, 0),
			author_id: "en/TieOne",
			author_name: null,
			text: "Same timestamp, earlier id",
		},
	];
	return [...crowd, ...burst, ...tie];
}

test("emits messages in chronological order", () => {
	const prepared = prepareEvidence({
		activeRegionId: "7",
		publicationDate: "2026-01-25",
		messages: sampleEvidence(),
	});

	const timestamps = prepared.messages.map((message) => message.ts);
	expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
	expect(prepared.final_count).toBeGreaterThan(10);
});

test("same evidence yields identical prepared evidence", () => {
	const first = prepareEvidence({
		activeRegionId: "7",
		publicationDate: "2026-01-25",
		messages: sampleEvidence(),
	});
	const second = prepareEvidence({
		activeRegionId: "7",
		publicationDate: "2026-01-25",
		messages: sampleEvidence().reverse(),
	});

	expect(second).toEqual(first);
	expect(first.drop_stats.burst_merged).toBe(1);
	expect(first.drop_stats.sampling_dropped).toBe(2);
});
