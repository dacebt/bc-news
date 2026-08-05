import { expect, it } from "vitest";
import { parseGenerationRunStatusResponse } from "../../../scripts/walk/generation-run-status";
import { assertExplicitNoEvidenceFailure } from "../../../scripts/walk/phases/scheduled-generation";

const PAIR = { active_region_id: "8", publication_date: "2026-01-25" } as const;

function erroredStatus(overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({
		active_region_id: PAIR.active_region_id,
		publication_date: PAIR.publication_date,
		generation_run_id: "generation-run-8-2026-01-25",
		state: "errored",
		current_step: null,
		completed_steps: [],
		model_usage: [],
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

it("parses the pair-addressed operator projection and explicit absent-evidence failure", () => {
	const response = parseGenerationRunStatusResponse(erroredStatus(), PAIR);
	expect(() => assertExplicitNoEvidenceFailure(response)).not.toThrow();
});

it("rejects a mismatched pair identity", () => {
	expect(() =>
		parseGenerationRunStatusResponse(erroredStatus({ active_region_id: "7" }), PAIR),
	).toThrow("invalid envelope");
});

it.each([
	{ failure: { step: "compose-main-story", code: "no_evidence_for_publication_date", message: "wrong step" } },
	{ failure: { step: "prepare-evidence", code: "different_failure", message: "wrong code" } },
	{ model_usage: [{ editorial_capability: "main_story" }] },
])("rejects an invalid absent-evidence operator projection %#", (override) => {
	let response;
	try {
		response = parseGenerationRunStatusResponse(erroredStatus(override), PAIR);
	} catch {
		return;
	}
	expect(() => assertExplicitNoEvidenceFailure(response)).toThrow();
});
