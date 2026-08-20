import assert from "node:assert/strict";
import test from "node:test";
import { extractWriterProvenance } from "../walk/phases/editorial-products";

const EDITION_BASE = {
	active_region_id: "7",
	publication_date: "2026-03-11",
	generation_run_id: "generation-run-7-2026-03-11",
	meta: {
		editorial_products: {
			main_story: {},
			announcements: {},
		},
	},
};

void test("extracts direct current writer provenance from EditionSchema editorial products", () => {
	const provenance = extractWriterProvenance({
		...EDITION_BASE,
		meta: {
			editorial_products: {
				main_story: { provider: "google", model: "gemini-3.7-flash" },
				announcements: { provider: "openai", model: "gpt-5.6-luna" },
			},
		},
	}, "main_story");
	assert.deepEqual(provenance, { provider: "google", model: "gemini-3.7-flash" });
});

void test("falls back only to the strict legacy write/copyedit provenance shape", () => {
	const provenance = extractWriterProvenance({
		...EDITION_BASE,
		meta: {
			editorial_products: {
				main_story: {
					write: { provider: "google", model: "gemini-3.7-flash" },
					copyedit: { provider: "openai", model: "gpt-5.6-luna" },
				},
				announcements: {
					write: { provider: "openai", model: "gpt-5-nano" },
					copyedit: { provider: "openai", model: "gpt-5.6-luna" },
				},
			},
		},
	}, "announcements");
	assert.deepEqual(provenance, { provider: "openai", model: "gpt-5-nano" });
});

void test("rejects partial nested provenance instead of treating write as a loose fallback", () => {
	assert.throws(
		() =>
			extractWriterProvenance({
				...EDITION_BASE,
				meta: {
					editorial_products: {
						main_story: {
							write: { provider: "google", model: "gemini-3.7-flash" },
						},
						announcements: { provider: "openai", model: "gpt-5.6-luna" },
					},
				},
			}, "main_story"),
		/invalid writer provenance/,
	);
});
