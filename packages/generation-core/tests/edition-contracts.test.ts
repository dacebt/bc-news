import { expect, test } from "vitest";
import {
	CURRENT_EDITION_VERSION,
	EditionRecordSchema,
	EditionSchema,
	LegacyEditionSchema,
	VersionedEditionV2Schema,
} from "@bc-news/contracts";

const counts = {
	raw_count: 3,
	after_filter_count: 3,
	after_burst_count: 2,
	final_count: 2,
};

const currentEdition = {
	version: CURRENT_EDITION_VERSION,
	active_region_id: "7",
	publication_date: "2026-01-25",
	title: "The Region Seven Gazette",
	game_references: [
		{
			token: "[[GAME_REF_001]]",
			kind: "coord",
			northing: 3745,
			easting: 3857,
			display_text: "South Gate",
			destination_url: "https://bitcraftmap.com/?center=3745,3857&zoom=3.0",
		},
		{
			token: "[[GAME_REF_002]]",
			kind: "item",
			id: "42",
			display_text: "Iron Sword",
			destination_url: "https://bitjita.com/items/42",
		},
	],
	announcements: [],
	main_story: {
		headline: "Bridge Work Completed",
		lede: "The crossing opened again.",
		body: "**Reporter** said it plainly.",
	},
	meta: {
		generated_at_utc: "2026-01-25T09:00:00.000Z",
		editorial_products: {
			main_story: { provider: "recorded", model: "writer-a" },
			announcements: { provider: "recorded", model: "writer-b" },
		},
		counts,
	},
};

const versionedEditionV2 = {
	version: 2,
	active_region_id: "7",
	publication_date: "2026-01-24",
	title: "The Region Seven Gazette",
	announcements: [],
	main_story: {
		headline: "Bridge Work Completed",
		lede: "The crossing opened again.",
		body: "**Reporter** said it plainly.",
	},
	meta: {
		generated_at_utc: "2026-01-24T09:00:00.000Z",
		editorial_products: {
			main_story: { provider: "recorded", model: "writer-a" },
			announcements: { provider: "recorded", model: "writer-b" },
		},
		counts,
	},
};

const legacyEdition = {
	active_region_id: "7",
	publication_date: "2026-01-25",
	title: "The Region Seven Gazette",
	subtitle: "January 25, 2026",
	announcements: [],
	main_story: {
		headline: "Bridge Work Completed",
		lede: "The crossing opened again.",
		body: "**Reporter** said it plainly.",
		image: { url: "https://example.test/image.png", caption: "Bridge" },
	},
	meta: {
		generated_at_utc: "2026-01-25T09:00:00.000Z",
		editorial_products: {
			main_story: {
				write: { provider: "recorded", model: "writer-a" },
				copyedit: { provider: "recorded", model: "copyeditor-a" },
			},
			announcements: {
				write: { provider: "recorded", model: "writer-b" },
				copyedit: { provider: "recorded", model: "copyeditor-b" },
			},
		},
		counts,
	},
};

test("parses current and legacy editions through the unambiguous record boundary", () => {
	expect(EditionSchema.parse(currentEdition)).toEqual(currentEdition);
	expect(VersionedEditionV2Schema.parse(versionedEditionV2)).toEqual(versionedEditionV2);
	expect(LegacyEditionSchema.parse(legacyEdition)).toEqual(legacyEdition);
	expect(EditionRecordSchema.parse(currentEdition)).toEqual(currentEdition);
	expect(EditionRecordSchema.parse(versionedEditionV2)).toEqual(versionedEditionV2);
	expect(EditionRecordSchema.parse(legacyEdition)).toEqual(legacyEdition);
});

test("does not let untagged legacy editions masquerade as current", () => {
	expect(EditionSchema.safeParse(legacyEdition).success).toBe(false);
	expect(EditionSchema.safeParse(versionedEditionV2).success).toBe(false);
	expect(VersionedEditionV2Schema.safeParse(currentEdition).success).toBe(false);
	expect(VersionedEditionV2Schema.safeParse(legacyEdition).success).toBe(false);
	expect(LegacyEditionSchema.safeParse(currentEdition).success).toBe(false);
});

test("rejects duplicate retained game-reference tokens at the edition boundary", () => {
	const duplicateTokenEdition = {
		...currentEdition,
		game_references: [
			currentEdition.game_references[0],
			{
				...currentEdition.game_references[0],
				display_text: "North Gate",
			},
		],
	};

	expect(EditionSchema.safeParse(duplicateTokenEdition).success).toBe(false);
	expect(EditionRecordSchema.safeParse(duplicateTokenEdition).success).toBe(false);
});

test("rejects a current entity reference whose destination does not match its exact BitJita path", () => {
	const invalidDestinationEdition = {
		...currentEdition,
		game_references: [
			currentEdition.game_references[0]!,
			{
				...currentEdition.game_references[1]!,
				destination_url: "https://bitjita.com/items/0042",
			},
		],
	};

	expect(EditionSchema.safeParse(invalidDestinationEdition).success).toBe(false);
	expect(EditionRecordSchema.safeParse(invalidDestinationEdition).success).toBe(false);
});
