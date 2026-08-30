import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import {
	CURRENT_EDITION_VERSION,
	type Edition,
	type LegacyEdition,
	type VersionedEditionV2,
} from "@bc-news/contracts";
import { publishEdition, readEdition } from "../src/edition-store";

function currentEdition(headline: string): Edition {
	return {
		version: CURRENT_EDITION_VERSION,
		active_region_id: "9",
		publication_date: "2026-02-14",
		title: "The Widmoria Muster",
		game_references: [],
		announcements: [],
		main_story: { headline, lede: "A lede.", body: "A body." },
		meta: {
			generated_at_utc: "2026-02-14T00:00:00.000Z",
			editorial_products: {
				main_story: { provider: "recorded", model: "recorded/main-story-write-v2" },
				announcements: { provider: "recorded", model: "recorded/announcements-write-v2" },
			},
			counts: { raw_count: 1, after_filter_count: 1, after_burst_count: 1, final_count: 1 },
		},
	};
}

function versionedEditionV2(headline: string): VersionedEditionV2 {
	return {
		version: 2,
		active_region_id: "9",
		publication_date: "2026-02-13",
		title: "The Widmoria Muster",
		announcements: [],
		main_story: { headline, lede: "A lede.", body: "A body." },
		meta: {
			generated_at_utc: "2026-02-13T00:00:00.000Z",
			editorial_products: {
				main_story: { provider: "recorded", model: "recorded/main-story-write-v2" },
				announcements: { provider: "recorded", model: "recorded/announcements-write-v2" },
			},
			counts: { raw_count: 1, after_filter_count: 1, after_burst_count: 1, final_count: 1 },
		},
	};
}

function legacyEdition(headline: string): LegacyEdition {
	return {
		active_region_id: "9",
		publication_date: "2026-02-15",
		title: "The Widmoria Muster",
		subtitle: "February 15, 2026",
		announcements: [],
		main_story: {
			headline,
			lede: "A lede.",
			body: "A body.",
			image: { url: "https://example.test/image.png", caption: "legacy image" },
		},
		meta: {
			generated_at_utc: "2026-02-15T00:00:00.000Z",
			editorial_products: {
				main_story: {
					write: { provider: "recorded", model: "recorded/main-story-write-v1" },
					copyedit: { provider: "recorded", model: "recorded/main-story-copyedit-v1" },
				},
				announcements: {
					write: { provider: "recorded", model: "recorded/announcements-write-v1" },
					copyedit: { provider: "recorded", model: "recorded/announcements-copyedit-v1" },
				},
			},
			counts: { raw_count: 1, after_filter_count: 1, after_burst_count: 1, final_count: 1 },
		},
	};
}

it("second publish for same active region and publication date leaves one versioned current edition", async () => {
	await publishEdition(env.DB, currentEdition("First headline"), "2026-02-14T09:00:00.000Z");
	await publishEdition(env.DB, currentEdition("Second headline"), "2026-02-14T10:00:00.000Z");

	const row = await env.DB.prepare(
		"SELECT COUNT(*) AS editions, document_json FROM edition WHERE active_region_id = ?1 AND publication_date = ?2",
	)
		.bind("9", "2026-02-14")
		.first<{ editions: number; document_json: string }>();
	expect(row?.editions).toBe(1);
	expect(row?.document_json).toContain(`"version":${CURRENT_EDITION_VERSION}`);

	const served = await readEdition(env.DB, "9", "2026-02-14");
	expect(served?.main_story.headline).toBe("First headline");
	expect(served?.version).toBe(CURRENT_EDITION_VERSION);
});

it("upgrades a versioned v2 stored edition to the current reader contract with an empty reference roster", async () => {
	await env.DB.prepare(
		`INSERT INTO edition (active_region_id, publication_date, status, document_json, published_at_utc)
		 VALUES (?1, ?2, 'published', ?3, ?4)`,
	)
		.bind(
			"9",
			"2026-02-13",
			JSON.stringify(versionedEditionV2("Versioned v2 headline")),
			"2026-02-13T09:00:00.000Z",
		)
		.run();

	const served = await readEdition(env.DB, "9", "2026-02-13");
	expect(served).toMatchObject({
		version: CURRENT_EDITION_VERSION,
		title: "The Widmoria Muster",
		game_references: [],
		main_story: { headline: "Versioned v2 headline", lede: "A lede.", body: "A body." },
	});
});

it("reopens a valid legacy stored edition as the current reader contract without faked provenance", async () => {
	await env.DB.prepare(
		`INSERT INTO edition (active_region_id, publication_date, status, document_json, published_at_utc)
		 VALUES (?1, ?2, 'published', ?3, ?4)`,
	)
		.bind(
			"9",
			"2026-02-15",
			JSON.stringify(legacyEdition("Legacy headline")),
			"2026-02-15T09:00:00.000Z",
		)
		.run();

	const served = await readEdition(env.DB, "9", "2026-02-15");
	expect(served).toMatchObject({
		version: CURRENT_EDITION_VERSION,
		title: "The Widmoria Muster",
		game_references: [],
		main_story: { headline: "Legacy headline", lede: "A lede.", body: "A body." },
		meta: {
			editorial_products: {
				main_story: { provider: "recorded", model: "recorded/main-story-write-v1" },
				announcements: { provider: "recorded", model: "recorded/announcements-write-v1" },
			},
		},
	});
	if (served === undefined) throw new Error("Expected served legacy edition");
	expect("subtitle" in served).toBe(false);
	expect("image" in served.main_story).toBe(false);
});
