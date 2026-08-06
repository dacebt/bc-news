import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import type { Edition } from "@bc-news/contracts";
import { publishEdition, readEdition } from "../src/edition-store";

function editionWithHeadline(headline: string): Edition {
	return {
		active_region_id: "9",
		publication_date: "2026-02-14",
		title: "The Widmoria Muster",
		subtitle: "February 14, 2026",
		announcements: [],
		main_story: { headline, lede: "A lede.", body: "A body." },
		meta: {
			generated_at_utc: "2026-02-14T00:00:00.000Z",
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

it("second publish for same active region and publication date leaves one edition", async () => {
	await publishEdition(env.DB, editionWithHeadline("First headline"), "2026-02-14T09:00:00.000Z");
	await publishEdition(env.DB, editionWithHeadline("Second headline"), "2026-02-14T10:00:00.000Z");

	const row = await env.DB.prepare(
		"SELECT COUNT(*) AS editions FROM edition WHERE active_region_id = ?1 AND publication_date = ?2",
	)
		.bind("9", "2026-02-14")
		.first<{ editions: number }>();
	expect(row?.editions).toBe(1);

	const served = await readEdition(env.DB, "9", "2026-02-14");
	expect(served?.main_story.headline).toBe("First headline");
});
