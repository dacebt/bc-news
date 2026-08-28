import { expect, test } from "vitest";
import { EvidenceFixtureSchema, type EvidenceMessage } from "@bc-news/contracts";
import { prepareEvidence } from "@bc-news/generation-core";
import evidenceFixtureJson from "../evidence/active-region-7_2026-01-24.json";

const ACTIVE_REGION_ID = "7";
const PUBLICATION_DATE = "2026-01-25";
const fixture = EvidenceFixtureSchema.parse(evidenceFixtureJson);

function prepare(messages: readonly EvidenceMessage[]) {
	return prepareEvidence({ activeRegionId: ACTIVE_REGION_ID, publicationDate: PUBLICATION_DATE, messages });
}

test("the canonical evidence preparation retains every message surviving hygiene", () => {
	const prepared = prepare(fixture.messages);

	expect(prepared.final_count).toBe(553);
	expect(prepared.final_count).toBe(prepared.after_burst_count);
});

test("deterministic selection is independent of source row order", () => {
	const forward = prepare(fixture.messages);
	const reverse = prepare([...fixture.messages].reverse());

	expect(reverse).toEqual(forward);
});

test("prepared messages remain unique and ordered by timestamp then id", () => {
	const messages = prepare(fixture.messages).messages;
	expect(new Set(messages.map((message) => message.id)).size).toBe(messages.length);
	for (let index = 1; index < messages.length; index += 1) {
		const previous = messages[index - 1]!;
		const current = messages[index]!;
		expect(previous.ts < current.ts || (previous.ts === current.ts && previous.id < current.id)).toBe(true);
	}
});

test("a retained null author name is represented as an empty string", () => {
	const canonical = prepare(fixture.messages);
	const retained = canonical.messages[0]!;
	const probed = fixture.messages.map((message) =>
		message.id === retained.id ? { ...message, author_name: null } : message
	);

	expect(prepare(probed).messages.find((message) => message.id === retained.id)?.author_name).toBe("");
});
