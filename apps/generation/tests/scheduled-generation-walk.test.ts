import { expect, it } from "vitest";
import {
	assertExplicitNoEvidenceFailure,
	parseGenerationRunStatusResponse,
} from "../../../scripts/walk/phases/scheduled-generation";

const INSTANCE_ID = "generation-run-8-2026-01-25";

it("normalizes the observed generic platform error with a leading no-evidence code", () => {
	const response = parseGenerationRunStatusResponse(
		JSON.stringify({
			id: INSTANCE_ID,
			status: {
				status: "errored",
				error: {
					name: "Error",
					message:
						"no_evidence_for_publication_date: No evidence for active region 8",
				},
			},
		}),
		INSTANCE_ID,
	);

	expect(() => assertExplicitNoEvidenceFailure(response)).not.toThrow();
});

it("also accepts the direct typed error name defined by NonRetryableError", () => {
	const response = parseGenerationRunStatusResponse(
		JSON.stringify({
			id: INSTANCE_ID,
			status: {
				status: "errored",
				error: {
					name: "no_evidence_for_publication_date",
					message: "No evidence for active region 8",
				},
			},
		}),
		INSTANCE_ID,
	);

	expect(() => assertExplicitNoEvidenceFailure(response)).not.toThrow();
});

it("rejects status and error tokens outside the nested Workflow status envelope", () => {
	expect(() =>
		parseGenerationRunStatusResponse(
			JSON.stringify({
				id: INSTANCE_ID,
				status: "errored",
				error: { name: "no_evidence_for_publication_date", message: "misplaced" },
			}),
			INSTANCE_ID,
		),
	).toThrow("invalid envelope");
});

it("rejects an errored Workflow whose nested error has a different code", () => {
	const response = parseGenerationRunStatusResponse(
		JSON.stringify({
			id: INSTANCE_ID,
			status: {
				status: "errored",
				error: { name: "different_failure", message: "wrong failure" },
			},
		}),
		INSTANCE_ID,
	);

	expect(() => assertExplicitNoEvidenceFailure(response)).toThrow(
		"did not expose nested errored/no_evidence_for_publication_date status",
	);
});

it.each([
	{
		label: "mid-message token",
		name: "Error",
		message: "Workflow failed: no_evidence_for_publication_date: No evidence",
	},
	{
		label: "wrong prefix separator",
		name: "Error",
		message: "no_evidence_for_publication_date - No evidence",
	},
	{
		label: "non-generic wrapper name",
		name: "WorkflowError",
		message: "no_evidence_for_publication_date: No evidence",
	},
] as const)("rejects $label", ({ name, message }) => {
	const response = parseGenerationRunStatusResponse(
		JSON.stringify({
			id: INSTANCE_ID,
			status: { status: "errored", error: { name, message } },
		}),
		INSTANCE_ID,
	);

	expect(() => assertExplicitNoEvidenceFailure(response)).toThrow(
		"did not expose nested errored/no_evidence_for_publication_date status",
	);
});
