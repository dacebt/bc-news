import { expect, test } from "vitest";
import { EvidenceFixtureSchema, type EvidenceMessage } from "@bc-news/contracts";
import { evidenceWindowForPublicationDate, prepareEvidence } from "@bc-news/generation-core";
import announcementFixtureJson from "../evidence/game-reference-announcement-links.json";
import fixtureJson from "../evidence/game-reference-links.json";

const fixture = EvidenceFixtureSchema.parse(fixtureJson);
const announcementFixture = EvidenceFixtureSchema.parse(announcementFixtureJson);

function ids(messages: readonly EvidenceMessage[]): readonly string[] {
	return messages.map((message) => message.id);
}

test("the game-reference fixture keeps the labeled Fire Nation marker and the explicit synthetic bare twin", () => {
	expect(fixture.active_region_id).toBe("19");
	expect(fixture.evidence_date).toBe("2026-08-15");
	expect(fixture.messages.find((message) => message.text === "[Fire Nation](coord=7968,9659)"))
		.toBeDefined();
	expect(fixture.messages.find((message) => message.id === "synthetic-game-reference-links-001"))
		.toEqual(expect.objectContaining({
			text: "(coord=7968,9659)",
			author_id: "synthetic/FixtureScout",
			author_name: "FixtureScout",
		}));
	expect(fixture.messages.find((message) => message.id === "synthetic-game-reference-links-002"))
		.toEqual(expect.objectContaining({
			text: "[Fire Nation] (coord=9001,9002)",
			author_id: "synthetic/FixtureScoutGap",
			author_name: "FixtureScoutGap",
		}));
	expect(fixture.messages.find((message) => message.id === "synthetic-game-reference-links-003"))
		.toEqual(expect.objectContaining({
			text: "[](coord=9003,9004)",
			author_id: "synthetic/FixtureScoutEmpty",
			author_name: "FixtureScoutEmpty",
		}));
	expect(fixture.messages.find((message) => message.id === "synthetic-game-reference-links-004"))
		.toEqual(expect.objectContaining({
			text: "https://example.test/?focus=(coord=9005,9006)",
			author_id: "synthetic/FixtureScoutUrl",
			author_name: "FixtureScoutUrl",
		}));
	expect(fixture.messages.find((message) => message.id === "synthetic-game-reference-links-005"))
		.toEqual(expect.objectContaining({
			text: "[Map](https://example.test/?focus=(coord=9007,9008))",
			author_id: "synthetic/FixtureScoutMarkdown",
			author_name: "FixtureScoutMarkdown",
		}));
	expect(fixture.messages.find((message) => message.id === "864691130352491563"))
		.toEqual(expect.objectContaining({
			text: "anyone wanna help were almost at the boss(coord=7097,4729)",
			author_id: "en/abeaupre91",
			author_name: "abeaupre91",
		}));
	expect(fixture.messages.find((message) => message.id === "864691130352830189"))
		.toEqual(expect.objectContaining({
			text: "damn just too late",
			author_id: "en/Donner",
			author_name: "Donner",
		}));
});

test("the game-reference fixture still prepares as one evidence-day corpus with stable token order", () => {
	const { startMs, endMs } = evidenceWindowForPublicationDate("2026-08-16");
	expect(new Set(ids(fixture.messages)).size).toBe(fixture.messages.length);
	expect(fixture.messages.every((message) => message.ts >= startMs && message.ts < endMs)).toBe(true);

	const prepared = prepareEvidence({
		activeRegionId: fixture.active_region_id,
		publicationDate: "2026-08-16",
		messages: fixture.messages,
	});
	expect(prepared.messages[0]?.text).toBe("would be funny if another server had the Fire Nation");
	expect(prepared.messages.find((message) => message.id === "1369094288557488427")?.text)
		.toBe("its everywhere\n[Fire Nation](coord=7968,9659)");
	expect(prepared.messages.find((message) => message.id === "synthetic-game-reference-links-001")?.text)
		.toBe("(coord=7968,9659)");
	expect(prepared.game_references).toHaveLength(8);
	expect(prepared.game_references.slice(0, 2)).toEqual([
		expect.objectContaining({
			token: "[[GAME_REF_001]]",
			northing: 7968,
			easting: 9659,
			display_text: "Fire Nation",
		}),
		expect.objectContaining({
			token: "[[GAME_REF_002]]",
			northing: 7968,
			easting: 9659,
			display_text: "N 7968, E 9659",
		}),
	]);
	expect(prepared.game_references.some((reference) => reference.kind === "coord" && reference.northing === 9001 && reference.easting === 9002)).toBe(false);
	expect(prepared.game_references.some((reference) => reference.kind === "coord" && reference.northing === 9003 && reference.easting === 9004)).toBe(false);
	expect(prepared.game_references.some((reference) => reference.kind === "coord" && reference.northing === 9005 && reference.easting === 9006)).toBe(false);
	expect(prepared.game_references.some((reference) => reference.kind === "coord" && reference.northing === 9007 && reference.easting === 9008)).toBe(false);
	expect(prepared.game_references[7]).toEqual(expect.objectContaining({
		token: "[[GAME_REF_008]]",
		northing: 7097,
		easting: 4729,
		display_text: "N 7097, E 4729",
	}));
});

test("the announcement fixture retains one explicit completed public milestone with its coordinate", () => {
	const { startMs, endMs } = evidenceWindowForPublicationDate("2026-08-17");
	expect(announcementFixture.active_region_id).toBe("7");
	expect(announcementFixture.evidence_date).toBe("2026-08-16");
	expect(announcementFixture.messages.every((message) => message.ts >= startMs && message.ts < endMs)).toBe(true);
	expect(announcementFixture.messages.find((message) => message.id === "504403161229375743"))
		.toEqual(expect.objectContaining({
			text: "I added a vulconi light to the FIHS at (coord=3862,4480); don´t miss the daily buff",
			author_id: "en/Dyrac",
			author_name: "Dyrac",
		}));

	const prepared = prepareEvidence({
		activeRegionId: announcementFixture.active_region_id,
		publicationDate: "2026-08-17",
		messages: announcementFixture.messages,
	});
	expect(prepared.game_references).toEqual([
		expect.objectContaining({
			token: "[[GAME_REF_001]]",
			northing: 3862,
			easting: 4480,
			display_text: "N 3862, E 4480",
		}),
	]);
});
