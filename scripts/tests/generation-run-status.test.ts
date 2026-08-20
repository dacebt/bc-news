import assert from "node:assert/strict";
import test from "node:test";
import { parseGenerationRunStatusResponse } from "../walk/generation-run-status";

const PAIR = {
	active_region_id: "7",
	publication_date: "2026-03-11",
} as const;

const GENERATION_RUN_ID = `generation-run-${PAIR.active_region_id}-${PAIR.publication_date}`;

const BASE_WORKFLOW = {
	observation: "available",
	status: "complete",
	error: null,
} as const;

const CURRENT_STATUS = {
	contract_version: "current_v1",
	active_region_id: PAIR.active_region_id,
	publication_date: PAIR.publication_date,
	generation_run_id: GENERATION_RUN_ID,
	state: "complete",
	current_step: null,
	completed_steps: [
		"prepare-evidence",
		"main_story_write",
		"announcements_write",
		"validate-edition",
		"publish-edition",
	],
	model_usage: [
		{
			production_step: "main_story_write",
			provider: "google",
			model: "gemini-3.7-flash",
			execution: "hosted_inference",
			token_usage: { measurement: "reported", input_tokens: 100, output_tokens: 25, total_tokens: 125 },
			external_billing: { classification: "unavailable", reason: "provider_did_not_report_cost" },
		},
		{
			production_step: "announcements_write",
			provider: "google",
			model: "gemini-3.7-flash",
			execution: "hosted_inference",
			token_usage: { measurement: "reported", input_tokens: 80, output_tokens: 20, total_tokens: 100 },
			external_billing: { classification: "unavailable", reason: "provider_did_not_report_cost" },
		},
	],
	diagnostics: [{
		kind: "final_product",
		production_step: "main_story_write",
		code: "forbidden_marker",
		message: "forbidden token",
	}],
	failure: null,
	workflow: BASE_WORKFLOW,
};

const LEGACY_STATUS = {
	active_region_id: PAIR.active_region_id,
	publication_date: PAIR.publication_date,
	generation_run_id: GENERATION_RUN_ID,
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
	model_usage: [
		{
			production_step: "main_story_write",
			provider: "google",
			model: "gemini-3.7-flash",
			execution: "hosted_inference",
			token_usage: { measurement: "reported", input_tokens: 100, output_tokens: 25, total_tokens: 125 },
			external_billing: { classification: "unavailable", reason: "provider_did_not_report_cost" },
		},
		{
			production_step: "main_story_copyedit",
			provider: "google",
			model: "gemini-3.7-flash",
			execution: "hosted_inference",
			token_usage: { measurement: "reported", input_tokens: 60, output_tokens: 20, total_tokens: 80 },
			external_billing: { classification: "unavailable", reason: "provider_did_not_report_cost" },
		},
		{
			production_step: "announcements_write",
			provider: "google",
			model: "gemini-3.7-flash",
			execution: "hosted_inference",
			token_usage: { measurement: "reported", input_tokens: 70, output_tokens: 15, total_tokens: 85 },
			external_billing: { classification: "unavailable", reason: "provider_did_not_report_cost" },
		},
		{
			production_step: "announcements_copyedit",
			provider: "google",
			model: "gemini-3.7-flash",
			execution: "hosted_inference",
			token_usage: { measurement: "reported", input_tokens: 55, output_tokens: 10, total_tokens: 65 },
			external_billing: { classification: "unavailable", reason: "provider_did_not_report_cost" },
		},
	],
	diagnostics: [
		{
			kind: "preservation",
			production_step: "main_story_copyedit",
			code: "paragraph_count",
			message: "copyedit changed paragraph count",
		},
		{
			kind: "final_product",
			production_step: "announcements_copyedit",
			code: "ungrounded_quote",
			message: "copyedit introduced an ungrounded quote",
		},
	],
	failure: null,
	workflow: BASE_WORKFLOW,
};

void test("parses the strict current versioned operator status", () => {
	const status = parseGenerationRunStatusResponse(JSON.stringify(CURRENT_STATUS), PAIR);
	assert.equal("contract_version" in status, true);
	if (!("contract_version" in status)) {
		throw new Error("Expected the strict current status contract");
	}
	assert.equal(status.contract_version, "current_v1");
	assert.deepEqual(status.completed_steps, CURRENT_STATUS.completed_steps);
	assert.deepEqual(status.diagnostics, CURRENT_STATUS.diagnostics);
});

void test("rejects legacy copyedit diagnostics in the current versioned operator status", () => {
	const invalid = structuredClone(CURRENT_STATUS);
	invalid.diagnostics = [{
		kind: "preservation",
		production_step: "main_story_copyedit",
		code: "paragraph_count",
		message: "legacy preservation",
	}];
	assert.throws(
		() => parseGenerationRunStatusResponse(JSON.stringify(invalid), PAIR),
		/invalid diagnostic/,
	);
});

void test("parses an untagged complete legacy operator status with copyedit diagnostics", () => {
	const status = parseGenerationRunStatusResponse(JSON.stringify(LEGACY_STATUS), PAIR);
	assert.equal(Object.hasOwn(status, "contract_version"), false);
	assert.deepEqual(status.completed_steps, LEGACY_STATUS.completed_steps);
	assert.deepEqual(status.diagnostics, LEGACY_STATUS.diagnostics);
});

void test("rejects an untagged five-step body instead of accepting it as current", () => {
	const invalid = { ...structuredClone(CURRENT_STATUS) };
	Reflect.deleteProperty(invalid, "contract_version");
	invalid.diagnostics = [];
	assert.throws(
		() => parseGenerationRunStatusResponse(JSON.stringify(invalid), PAIR),
		/unordered completed steps/,
	);
});
