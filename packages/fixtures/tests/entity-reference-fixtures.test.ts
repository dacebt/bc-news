import { expect, test } from "vitest";
import { EvidenceFixtureSchema, type EvidenceFixture } from "@bc-news/contracts";
import {
	evidenceWindowForPublicationDate,
	prepareEvidenceWithGameReferences,
	type GameReferenceEntityIdentity,
} from "@bc-news/generation-core";
import cargoCollectiblesFixtureJson from "../evidence/entity-reference-cargo-and-collectibles-region-18_2026-08-16.json";
import claimFixtureJson from "../evidence/entity-reference-claim-region-12_2026-08-16.json";
import localModelFixtureJson from "../evidence/entity-reference-links.json";
import resourceFixtureJson from "../evidence/entity-reference-resource-region-9_2026-08-15.json";
import syntheticFixtureJson from "../evidence/entity-reference-synthetic.json";
import {
	fixtureGameReferenceResolutionEntries,
	fixtureGameReferenceResolver,
	parseFixtureGameReferenceResolutionEntries,
	resolveFixtureGameReferenceIdentities,
} from "../src";

const resourceFixture = EvidenceFixtureSchema.parse(resourceFixtureJson);
const localModelFixture = EvidenceFixtureSchema.parse(localModelFixtureJson);
const claimFixture = EvidenceFixtureSchema.parse(claimFixtureJson);
const cargoCollectiblesFixture = EvidenceFixtureSchema.parse(cargoCollectiblesFixtureJson);
const syntheticFixture = EvidenceFixtureSchema.parse(syntheticFixtureJson);

function assertWindow(fixture: EvidenceFixture, publicationDate: string): void {
	const { startMs, endMs } = evidenceWindowForPublicationDate(publicationDate);
	expect(fixture.messages.every((message) => message.ts >= startMs && message.ts < endMs)).toBe(true);
}

test("keeps the committed BitJita entity resolution roster strict and duplicate-free", async () => {
	expect(fixtureGameReferenceResolutionEntries()).toEqual([
		{ kind: "item", id: "163977632", name: "Ornate Leather Shirt" },
		{ kind: "cargo", id: "833769059", name: "Settlement Foundation Kit" },
		{ kind: "claim", id: "864691128594607212", name: "Serpents Hold" },
		{ kind: "coll", id: "381044074", name: "Wagon (III)" },
		{ kind: "res", id: "1045808810", name: "Pyrelite Outcrop Interior" },
	]);
	expect(() => parseFixtureGameReferenceResolutionEntries([
		{ kind: "item", id: "163977632", name: "Ornate Leather Shirt", extra: true },
	])).toThrow();
	expect(() => parseFixtureGameReferenceResolutionEntries([
		{ kind: "item", id: "163977632", name: "Ornate Leather Shirt" },
		{ kind: "item", id: "163977632", name: "Ornate Leather Shirt" },
	])).toThrow("repeat canonical identity item:163977632");
	expect(() => parseFixtureGameReferenceResolutionEntries([
		{ kind: "item", id: "0", name: "Zero Id" },
	])).toThrow();
	expect(() => parseFixtureGameReferenceResolutionEntries([
		{ kind: "item", id: "01", name: "Leading Zero Id" },
	])).toThrow();

	const identities: readonly GameReferenceEntityIdentity[] = [
		{ kind: "claim", id: "864691128594607212" },
		{ kind: "item", id: "999999999" },
		{ kind: "res", id: "1045808810" },
	];
	expect(resolveFixtureGameReferenceIdentities(identities)).toEqual([
		{ kind: "claim", id: "864691128594607212", outcome: "resolved", display_name: "Serpents Hold" },
		{ kind: "item", id: "999999999", outcome: "unknown" },
		{ kind: "res", id: "1045808810", outcome: "resolved", display_name: "Pyrelite Outcrop Interior" },
	]);
	await expect(fixtureGameReferenceResolver.resolve(identities)).resolves.toEqual([
		{ kind: "claim", id: "864691128594607212", outcome: "resolved", display_name: "Serpents Hold" },
		{ kind: "item", id: "999999999", outcome: "unknown" },
		{ kind: "res", id: "1045808810", outcome: "resolved", display_name: "Pyrelite Outcrop Interior" },
	]);
});

test("retains the exact public entity rows without mixing regions or evidence dates", () => {
	expect(resourceFixture.active_region_id).toBe("9");
	expect(resourceFixture.evidence_date).toBe("2026-08-15");
	assertWindow(resourceFixture, "2026-08-16");
	expect(resourceFixture.messages.find((message) => message.id === "648518348406086663")).toEqual(
		expect.objectContaining({
			text: "Beuwolf (res=1045808810)",
			author_id: "en/PussInBoots",
			author_name: "PussInBoots",
		}),
	);

	expect(localModelFixture.active_region_id).toBe("9");
	expect(localModelFixture.evidence_date).toBe("2026-08-16");
	assertWindow(localModelFixture, "2026-08-17");
	expect(localModelFixture.messages.find((message) => message.id === "648518348451327843")).toEqual(
		expect.objectContaining({
			text: "(item=163977632)(item=264387410)(item=1122421091)",
			author_id: "fr/Lintha",
			author_name: "Lintha",
		}),
	);

	expect(claimFixture.active_region_id).toBe("12");
	expect(claimFixture.evidence_date).toBe("2026-08-16");
	assertWindow(claimFixture, "2026-08-17");
	expect(claimFixture.messages).toEqual([
		expect.objectContaining({
			id: "864691130399305766",
			text: "Everyone is welcome to come check out (claim=864691128594607212) its a work in progress still",
			author_id: "en/ShadowTrip",
			author_name: "ShadowTrip",
		}),
	]);

	expect(cargoCollectiblesFixture.active_region_id).toBe("18");
	expect(cargoCollectiblesFixture.evidence_date).toBe("2026-08-16");
	assertWindow(cargoCollectiblesFixture, "2026-08-17");
	expect(cargoCollectiblesFixture.messages.find((message) => message.id === "1297036694523305777")).toEqual(
		expect.objectContaining({
			text: "oiii :D (cargo=833769059)",
			author_id: "en/RoyalSailor",
			author_name: "RoyalSailor",
		}),
	);
	expect(cargoCollectiblesFixture.messages.find((message) => message.id === "1297036694537291404")).toEqual(
		expect.objectContaining({
			text: "(coll=381044074) + (coll=693157662) + (coll=1289105478)",
			author_id: "en/Geniewiz",
			author_name: "Geniewiz",
		}),
	);
});

test("covers every supported entity kind across the public corpus-grounded fixtures", () => {
	const publicFixtures = [
		resourceFixture,
		localModelFixture,
		claimFixture,
		cargoCollectiblesFixture,
	];
	const coverage = new Set(
		publicFixtures.flatMap((fixture) => fixture.messages.flatMap(({ text }) => {
			const kinds = text.match(/\((item|cargo|claim|coll|res)=/gu) ?? [];
			return kinds.map((match) => match.slice(1, match.indexOf("=")));
		})),
	);

	expect([...coverage].sort()).toEqual(["cargo", "claim", "coll", "item", "res"]);
});

test("keeps the synthetic know, malformed, and dedupe cases explicitly labeled synthetic", async () => {
	expect(syntheticFixture.messages.every((message) => message.author_id.startsWith("synthetic/"))).toBe(true);
	expect(syntheticFixture.messages.map(({ text }) => text)).toEqual([
		"(item=163977632)",
		"repeat that one too (item=163977632)",
		"(know=864691128594607212)",
		"(item=not-a-number)",
		"(res=1045808810) and again (res=1045808810)",
	]);

	const prepared = await prepareEvidenceWithGameReferences(
		{
			activeRegionId: syntheticFixture.active_region_id,
			publicationDate: "2026-08-17",
			messages: syntheticFixture.messages,
		},
		fixtureGameReferenceResolver,
	);

	expect(prepared.game_references).toEqual([
		{
			token: "[[GAME_REF_001]]",
			kind: "item",
			id: "163977632",
			display_text: "Ornate Leather Shirt",
			destination_url: "https://bitjita.com/items/163977632",
		},
		{
			token: "[[GAME_REF_002]]",
			kind: "res",
			id: "1045808810",
			display_text: "Pyrelite Outcrop Interior",
			destination_url: "https://bitjita.com/resources/1045808810",
		},
	]);
	expect(prepared.messages.find(({ id }) => id === "synthetic-entity-reference-003")?.text)
		.toContain("(know=864691128594607212)");
	expect(prepared.messages.find(({ id }) => id === "synthetic-entity-reference-004")?.text)
		.toContain("(item=not-a-number)");
});

test("the selected local-model entity fixture resolves the established item and leaves unresolved siblings out of the trusted roster", async () => {
	const prepared = await prepareEvidenceWithGameReferences(
		{
			activeRegionId: localModelFixture.active_region_id,
			publicationDate: "2026-08-17",
			messages: localModelFixture.messages,
		},
		fixtureGameReferenceResolver,
	);

	expect(prepared.game_references).toEqual([
		{
			token: "[[GAME_REF_001]]",
			kind: "item",
			id: "163977632",
			display_text: "Ornate Leather Shirt",
			destination_url: "https://bitjita.com/items/163977632",
		},
	]);
	expect(prepared.messages.find(({ id }) => id === "648518348451309793")?.text)
		.toContain("(item=163977632)(item=264387410)(item=1122421091)");
});
