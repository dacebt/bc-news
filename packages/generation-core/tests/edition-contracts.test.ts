import { expect, test } from "vitest";
import {
	CURRENT_EDITION_VERSION,
	EditionRecordSchema,
	EditionSchema,
	LegacyEditionSchema,
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
	expect(LegacyEditionSchema.parse(legacyEdition)).toEqual(legacyEdition);
	expect(EditionRecordSchema.parse(currentEdition)).toEqual(currentEdition);
	expect(EditionRecordSchema.parse(legacyEdition)).toEqual(legacyEdition);
});

test("does not let untagged legacy editions masquerade as current", () => {
	expect(EditionSchema.safeParse(legacyEdition).success).toBe(false);
	expect(LegacyEditionSchema.safeParse(currentEdition).success).toBe(false);
});
