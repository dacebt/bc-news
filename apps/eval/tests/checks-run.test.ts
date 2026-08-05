import { expect, test } from "vitest";
import type { PreparedEvidence, PreparedMessage } from "@bc-news/generation-core";
import { parseMainStoryOutput } from "@bc-news/generation-core";
import { fixtureEvidenceInput, recordedModelProvider } from "@bc-news/fixtures";
import { runEvalChecks } from "../src/checks";

async function preparedEvidenceFixture(): Promise<PreparedEvidence> {
	const evidenceMessages = await fixtureEvidenceInput.loadEvidence({
		activeRegionId: "7",
		evidenceDate: "2026-01-24",
	});
	const messages: PreparedMessage[] = evidenceMessages.map((message) => ({
		id: message.id,
		ts: message.ts,
		author_id: message.author_id,
		author_name: message.author_name ?? "",
		text: message.text,
	}));
	return {
		active_region_id: "7",
		publication_date: "2026-01-25",
		raw_count: messages.length,
		after_filter_count: messages.length,
		after_burst_count: messages.length,
		final_count: messages.length,
		drop_stats: { empty_after_trim: 0, too_short: 0, burst_merged: 0 },
		messages,
	};
}

test("returns the check tuple in stable order with the schema entry pre-validated", async () => {
	const preparedEvidence = await preparedEvidenceFixture();
	const { text } = await recordedModelProvider.complete({
		editorialCapability: "main_story",
		system: "",
		user: "",
	});
	const output = parseMainStoryOutput(text);

	const results = runEvalChecks({
		editorialCapability: "main_story",
		rawText: text,
		output,
		preparedEvidence,
	});

	expect(results.map((result) => result.name)).toEqual([
		"injection",
		"grounding",
		"schema",
		"formatting",
		"stage_specific",
	]);
	const schemaResult = results.find((result) => result.name === "schema");
	expect(schemaResult?.passed).toBe(true);
	expect(schemaResult?.detail.length).toBeGreaterThan(0);
});
