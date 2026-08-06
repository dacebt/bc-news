import { expect, test } from "vitest";
import { EvidenceFixtureSchema, type EvidenceMessage } from "@bc-news/contracts";
import {
	DuplicateEvidenceIdError,
	EvidenceOutOfWindowError,
	evidenceWindowForPublicationDate,
	prepareEvidence,
	type PreparedEvidence,
} from "@bc-news/generation-core";
import evidenceFixtureJson from "../evidence/active-region-7_2026-01-24.json";

const ACTIVE_REGION_ID = "7";
const EVIDENCE_DATE = "2026-01-24";
const PUBLICATION_DATE = "2026-01-25";

const fixture = EvidenceFixtureSchema.parse(evidenceFixtureJson);

function prepare(messages: readonly EvidenceMessage[]): PreparedEvidence {
	return prepareEvidence({ activeRegionId: ACTIVE_REGION_ID, publicationDate: PUBLICATION_DATE, messages });
}

test("the canonical corpus is the region and evidence date the harness is built around", () => {
	expect(fixture.active_region_id).toBe(ACTIVE_REGION_ID);
	expect(fixture.evidence_date).toBe(EVIDENCE_DATE);
	expect(fixture.messages.length).toBeGreaterThan(0);
});

test("every row carries a distinct id", () => {
	const ids = fixture.messages.map((message) => message.id);

	expect(new Set(ids).size).toBe(ids.length);
});

test("every row falls inside the evidence window the publication date derives", () => {
	const { startMs, endMs } = evidenceWindowForPublicationDate(PUBLICATION_DATE);

	const outside = fixture.messages.filter((message) => message.ts < startMs || message.ts >= endMs);

	expect(outside).toEqual([]);
});

/**
 * The corpus has to keep exercising the hygiene branches the fixture exists to
 * prove, or a green preparation check proves nothing: a corpus with no short
 * messages and no bursts would pass every property below while testing neither
 * filter.
 */
test("the corpus still exercises the length filter and the burst merge", () => {
	const prepared = prepare(fixture.messages);

	expect(prepared.drop_stats.too_short).toBeGreaterThan(0);
	expect(prepared.drop_stats.burst_merged).toBeGreaterThan(0);
});

test("a repeated evidence id rejects and names the offending id", () => {
	const duplicated = fixture.messages[0]!;

	try {
		prepare([...fixture.messages, duplicated]);
		throw new Error("expected prepareEvidence to reject a duplicate evidence id");
	} catch (error) {
		if (!(error instanceof DuplicateEvidenceIdError)) throw error;
		expect(error.id).toBe(duplicated.id);
	}
});

test("a row outside the window rejects and names the id, timestamp, and both bounds", () => {
	const { startMs, endMs } = evidenceWindowForPublicationDate(PUBLICATION_DATE);
	const outOfWindow: EvidenceMessage = {
		...fixture.messages[0]!,
		id: "out-of-window-probe",
		ts: endMs,
	};

	try {
		prepare([...fixture.messages, outOfWindow]);
		throw new Error("expected prepareEvidence to reject an out-of-window row");
	} catch (error) {
		if (!(error instanceof EvidenceOutOfWindowError)) throw error;
		expect(error.id).toBe(outOfWindow.id);
		expect(error.ts).toBe(endMs);
		expect(error.windowStart).toBe(startMs);
		expect(error.windowEnd).toBe(endMs);
	}
});
