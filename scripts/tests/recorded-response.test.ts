import assert from "node:assert/strict";
import test from "node:test";
import type {
	CurrentV1WalkGenerationRunStatus,
	CurrentV2WalkGenerationRunStatus,
} from "../walk/generation-run-status";
import {
	assertCompletedRecordedGenerationStatus,
	assertRecordedGenerationEvidenceUnchanged,
	recordedGenerationEvidence,
} from "../walk/recorded-response";

function createCurrentV1Status(): CurrentV1WalkGenerationRunStatus {
	return {
		contract_version: "current_v1",
		active_region_id: "7",
		publication_date: "2026-03-11",
		generation_run_id: "generation-run-7-2026-03-11",
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
				provider: "synthetic_fixture",
				model: "entity-reference-main-story-v3",
				execution: "recorded_replay",
				token_usage: { measurement: "unavailable" },
				external_billing: { classification: "none", amount_usd: 0, reason: "recorded_replay" },
			},
			{
				production_step: "announcements_write",
				provider: "synthetic_fixture",
				model: "entity-reference-announcements-v3",
				execution: "recorded_replay",
				token_usage: { measurement: "unavailable" },
				external_billing: { classification: "none", amount_usd: 0, reason: "recorded_replay" },
			},
		],
		diagnostics: [],
		failure: null,
		workflow: {
			observation: "available",
			status: "complete",
			error: null,
		},
	};
}

function createCurrentV2Status(): CurrentV2WalkGenerationRunStatus {
	return {
		contract_version: "current_v2",
		active_region_id: "7",
		publication_date: "2026-03-11",
		generation_run_id: "generation-run-7-2026-03-11",
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
				provider: "synthetic_fixture",
				model: "entity-reference-main-story-v3",
				execution: "recorded_replay",
				token_usage: { measurement: "unavailable" },
				external_billing: { classification: "none", amount_usd: 0, reason: "recorded_replay" },
			},
			{
				production_step: "announcements_write",
				provider: "synthetic_fixture",
				model: "entity-reference-announcements-v3",
				execution: "recorded_replay",
				token_usage: { measurement: "unavailable" },
				external_billing: { classification: "none", amount_usd: 0, reason: "recorded_replay" },
			},
		],
		model_attempts: [
			{
				production_step: "main_story_write",
				attempt: 1,
				invocation_id: "generation-run-7-2026-03-11-main_story_write-attempt-1",
				outcome: { status: "rejected", code: "invalid_json", message: "Writer returned invalid JSON" },
				model_usage: {
					production_step: "main_story_write",
					provider: "synthetic_fixture",
					model: "entity-reference-main-story-v3",
					execution: "recorded_replay",
					token_usage: { measurement: "unavailable" },
					external_billing: { classification: "none", amount_usd: 0, reason: "recorded_replay" },
				},
			},
			{
				production_step: "main_story_write",
				attempt: 2,
				invocation_id: "generation-run-7-2026-03-11-main_story_write-attempt-2",
				outcome: { status: "accepted" },
				model_usage: {
					production_step: "main_story_write",
					provider: "synthetic_fixture",
					model: "entity-reference-main-story-v3",
					execution: "recorded_replay",
					token_usage: { measurement: "unavailable" },
					external_billing: { classification: "none", amount_usd: 0, reason: "recorded_replay" },
				},
			},
			{
				production_step: "announcements_write",
				attempt: 1,
				invocation_id: "generation-run-7-2026-03-11-announcements_write-attempt-1",
				outcome: { status: "accepted" },
				model_usage: {
					production_step: "announcements_write",
					provider: "synthetic_fixture",
					model: "entity-reference-announcements-v3",
					execution: "recorded_replay",
					token_usage: { measurement: "unavailable" },
					external_billing: { classification: "none", amount_usd: 0, reason: "recorded_replay" },
				},
			},
		],
		diagnostics: [],
		failure: null,
		workflow: {
			observation: "available",
			status: "complete",
			error: null,
		},
	};
}

const CURRENT_V1_STATUS = createCurrentV1Status();
const CURRENT_V2_STATUS = createCurrentV2Status();

const RECORDED_RESPONSES = [
	{
		production_step: "main_story_write",
		provider: "synthetic_fixture",
		model: "entity-reference-main-story-v3",
		prompt_sha256: "1111111111111111111111111111111111111111111111111111111111111111",
		text: "{\"title\":\"unused\"}",
	},
	{
		production_step: "announcements_write",
		provider: "synthetic_fixture",
		model: "entity-reference-announcements-v3",
		prompt_sha256: "2222222222222222222222222222222222222222222222222222222222222222",
		text: "{\"announcements\":[]}",
	},
] as const;

void test("accepts the historical current_v1 recorded proof without attempt history", () => {
	assert.doesNotThrow(() =>
		assertCompletedRecordedGenerationStatus(CURRENT_V1_STATUS, RECORDED_RESPONSES),
	);
	const evidence = recordedGenerationEvidence(CURRENT_V1_STATUS);
	assert.deepEqual(evidence.model_attempts, []);
	assert.doesNotThrow(() => assertRecordedGenerationEvidenceUnchanged(evidence, CURRENT_V1_STATUS));
});

void test("accepts the exact recorded retry proof and snapshots attempt history for idempotency", () => {
	assert.doesNotThrow(() =>
		assertCompletedRecordedGenerationStatus(CURRENT_V2_STATUS, RECORDED_RESPONSES),
	);
	const evidence = recordedGenerationEvidence(CURRENT_V2_STATUS);
	assert.deepEqual(evidence.model_attempts, CURRENT_V2_STATUS.model_attempts);
	assert.doesNotThrow(() => assertRecordedGenerationEvidenceUnchanged(evidence, CURRENT_V2_STATUS));
});

void test("rejects when repeated generation changes retained attempt history", () => {
	const evidence = recordedGenerationEvidence(CURRENT_V2_STATUS);
	const changed = structuredClone(CURRENT_V2_STATUS);
	const retriedAttempt = changed.model_attempts.at(1);
	if (retriedAttempt === undefined) {
		throw new Error("Expected the accepted retry attempt");
	}
	retriedAttempt.invocation_id = "generation-run-7-2026-03-11-main_story_write-attempt-99";
	assert.throws(
		() => assertRecordedGenerationEvidenceUnchanged(evidence, changed),
		/model attempts changed/,
	);
});

void test("rejects a current_v2 recorded status when retry attempt evidence is missing", () => {
	const changed = structuredClone(CURRENT_V2_STATUS);
	changed.model_attempts = [];
	assert.throws(
		() => assertCompletedRecordedGenerationStatus(changed, RECORDED_RESPONSES),
		/model attempts did not retain the exact retry history/,
	);
});
