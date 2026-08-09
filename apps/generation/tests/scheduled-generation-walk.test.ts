import { expect, it } from "vitest";
import { parseGenerationRunStatusResponse } from "../../../scripts/walk/generation-run-status";
import {
	RECORDED_GENERATION_DIAGNOSTICS,
	assertCompletedRecordedGenerationStatus,
	type RecordedResponse,
} from "../../../scripts/walk/recorded-response";
import { assertExplicitNoEvidenceFailure } from "../../../scripts/walk/phases/scheduled-generation";

const PAIR = { active_region_id: "8", publication_date: "2026-01-25" } as const;
const RECORDED_RESPONSES: readonly RecordedResponse[] = [
	{
		production_step: "main_story_write",
		provider: "migrated_fixture",
		model: "legacy/main-story-plus-packaging-v1",
		prompt_sha256: "unused-by-operator-assertion",
		text: "unused-by-operator-assertion",
	},
	{
		production_step: "main_story_copyedit",
		provider: "synthetic_fixture",
		model: "preservation-copy-v1",
		prompt_sha256: "unused-by-operator-assertion",
		text: "unused-by-operator-assertion",
	},
	{
		production_step: "announcements_write",
		provider: "migrated_fixture",
		model: "legacy/announcements-v1",
		prompt_sha256: "unused-by-operator-assertion",
		text: "unused-by-operator-assertion",
	},
	{
		production_step: "announcements_copyedit",
		provider: "synthetic_fixture",
		model: "preservation-copy-v1",
		prompt_sha256: "unused-by-operator-assertion",
		text: "unused-by-operator-assertion",
	},
];

function erroredStatus(overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({
		active_region_id: PAIR.active_region_id,
		publication_date: PAIR.publication_date,
		generation_run_id: "generation-run-8-2026-01-25",
		state: "errored",
		current_step: null,
		completed_steps: [],
		model_usage: [],
		diagnostics: [],
		failure: {
			step: "prepare-evidence",
			code: "no_evidence_for_publication_date",
			message: "No evidence",
		},
		workflow: {
			observation: "available",
			status: "errored",
			error: { name: "no_evidence_for_publication_date", message: "No evidence" },
		},
		created_at_utc: "2026-08-04T23:00:00.000Z",
		updated_at_utc: "2026-08-04T23:01:00.000Z",
		...overrides,
	});
}

function completeStatus(overrides: Record<string, unknown> = {}): {
	readonly body: string;
	readonly responses: readonly RecordedResponse[];
} {
	const responses = RECORDED_RESPONSES;
	return {
		responses,
		body: JSON.stringify({
			active_region_id: PAIR.active_region_id,
			publication_date: PAIR.publication_date,
			generation_run_id: "generation-run-8-2026-01-25",
			state: "complete",
			current_step: null,
			completed_steps: [
				"prepare-evidence",
				"main_story_write",
				"main_story_copyedit",
				"announcements_write",
				"announcements_copyedit",
				"validate-edition",
				"publish-edition",
			],
			model_usage: responses.map((response) => ({
				production_step: response.production_step,
				provider: response.provider,
				model: response.model,
				execution: "recorded_replay",
				token_usage: { measurement: "unavailable" },
				external_billing: {
					classification: "none",
					amount_usd: 0,
					reason: "recorded_replay",
				},
			})),
			diagnostics: RECORDED_GENERATION_DIAGNOSTICS,
			failure: null,
			workflow: { observation: "available", status: "complete", error: null },
			created_at_utc: "2026-08-04T23:00:00.000Z",
			updated_at_utc: "2026-08-04T23:01:00.000Z",
			...overrides,
		}),
	};
}

it("parses the pair-addressed operator projection and explicit absent-evidence failure", () => {
	const response = parseGenerationRunStatusResponse(erroredStatus(), PAIR);
	expect(response.diagnostics).toEqual([]);
	expect(() => assertExplicitNoEvidenceFailure(response)).not.toThrow();
});

it("proves the completed recorded generation has four usages and the exact ordered diagnostics", () => {
	const { body, responses } = completeStatus();
	const status = parseGenerationRunStatusResponse(body, PAIR);

	expect(status.diagnostics).toEqual(RECORDED_GENERATION_DIAGNOSTICS);
	expect(() => assertCompletedRecordedGenerationStatus(status, responses)).not.toThrow();
});

it("rejects malformed or drifted recorded-generation diagnostics", () => {
	const { body: malformed } = completeStatus({
		diagnostics: [{
			...RECORDED_GENERATION_DIAGNOSTICS[0],
			unexpected: true,
		}],
	});
	expect(() => parseGenerationRunStatusResponse(malformed, PAIR)).toThrow("invalid diagnostic");

	const { body: reordered, responses } = completeStatus({
		diagnostics: [...RECORDED_GENERATION_DIAGNOSTICS].reverse(),
	});
	const status = parseGenerationRunStatusResponse(reordered, PAIR);
	expect(() => assertCompletedRecordedGenerationStatus(status, responses)).toThrow(
		"exact recorded evidence",
	);
});

it("rejects a mismatched pair identity", () => {
	expect(() =>
		parseGenerationRunStatusResponse(erroredStatus({ active_region_id: "7" }), PAIR),
	).toThrow("invalid envelope");
});

it.each([
	{ failure: { step: "main_story_write", code: "no_evidence_for_publication_date", message: "wrong step" } },
	{ failure: { step: "prepare-evidence", code: "different_failure", message: "wrong code" } },
	{ model_usage: [{ production_step: "main_story_write" }] },
])("rejects an invalid absent-evidence operator projection %#", (override) => {
	let response;
	try {
		response = parseGenerationRunStatusResponse(erroredStatus(override), PAIR);
	} catch {
		return;
	}
	expect(() => assertExplicitNoEvidenceFailure(response)).toThrow();
});
