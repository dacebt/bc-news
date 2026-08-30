import { expect, test } from "vitest";
import { CURRENT_EDITION_VERSION } from "@bc-news/contracts";
import {
	PRODUCTION_MODEL_STEPS,
	assembleEdition,
	type ModelUsageRecord,
	type PreparedEvidence,
} from "../src/index";

const PREPARED_EVIDENCE: PreparedEvidence = {
	active_region_id: "7",
	publication_date: "2026-01-25",
	raw_count: 1,
	after_filter_count: 1,
	after_burst_count: 1,
	final_count: 1,
	drop_stats: { empty_after_trim: 0, too_short: 0, burst_merged: 0 },
	game_references: [{
		token: "[[GAME_REF_001]]",
		kind: "coord",
		northing: 3745,
		easting: 3857,
		display_text: "South Gate",
		destination_url: "https://bitcraftmap.com/?center=3745,3857&zoom=3.0",
	}],
	messages: [{
		id: "m1",
		ts: Date.UTC(2026, 0, 24, 12),
		author_id: "author-1",
		author_name: "Reporter",
		text: "The bridge opened.",
	}],
};

function modelUsages(): ModelUsageRecord[] {
	return PRODUCTION_MODEL_STEPS.map((productionStep, index) => ({
		production_step: productionStep,
		provider: `provider-${index + 1}`,
		model: `model-${index + 1}`,
		execution: "recorded_replay",
		token_usage: { measurement: "unavailable" },
		external_billing: {
			classification: "none",
			amount_usd: 0,
			reason: "recorded_replay",
		},
	}));
}

function assemble(modelUsagesInput: readonly ModelUsageRecord[]) {
	return assembleEdition({
		mainStory: {
			title: "The Region Seven Gazette",
			main_story: {
				headline: "Builders Finish the Crossing",
				lede: "The region can cross the river again.",
				body: "**Reporter** confirmed that the bridge opened.",
			},
		},
		announcements: {
			announcements: [{
				title: "Bridge Crew Completes Work",
				summary: "**Reporter** marked the crossing complete.",
			}],
		},
		preparedEvidence: PREPARED_EVIDENCE,
		generatedAtUtc: "2026-01-25T09:00:00.000Z",
		modelUsages: modelUsagesInput,
	});
}

test("assembles the current versioned edition from the two-step usage roster", () => {
	const edition = assemble(modelUsages());

	expect(edition.version).toBe(CURRENT_EDITION_VERSION);
	expect(edition.active_region_id).toBe(PREPARED_EVIDENCE.active_region_id);
	expect(edition.publication_date).toBe(PREPARED_EVIDENCE.publication_date);
	expect(edition.game_references).toEqual(PREPARED_EVIDENCE.game_references);
	expect(edition.meta.editorial_products).toEqual({
		main_story: { provider: "provider-1", model: "model-1" },
		announcements: { provider: "provider-2", model: "model-2" },
	});
});

test("rejects an incomplete, duplicated, or reordered two-step production usage roster", () => {
	const usages = modelUsages();

	expect(() => assemble(usages.slice(0, 1))).toThrow();
	expect(() => assemble([usages[0]!, usages[0]!])).toThrow();
	expect(() => assemble([usages[1]!, usages[0]!])).toThrow();
});
