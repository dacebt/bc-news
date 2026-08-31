import assert from "node:assert/strict";
import test from "node:test";
import {
	parseGenerationRunStatusResponse,
	type CurrentV1WalkGenerationRunStatus,
	type CurrentV2WalkGenerationRunStatus,
	type LegacyWalkGenerationRunStatus,
} from "../walk/generation-run-status";

const PAIR = {
	active_region_id: "7",
	publication_date: "2026-03-11",
} as const;
const GENERATION_RUN_ID = `generation-run-${PAIR.active_region_id}-${PAIR.publication_date}`;
const BASE_WORKFLOW = { observation: "available", status: "complete", error: null } as const;
const TOKEN_USAGE = {
	measurement: "reported" as const,
	input_tokens: 100,
	output_tokens: 25,
	total_tokens: 125,
};
const UNAVAILABLE_BILLING = {
	classification: "unavailable" as const,
	reason: "provider_did_not_report_cost" as const,
};

function usage(production_step: "main_story_write" | "announcements_write", provider = "google", model = "gemini-3.7-flash") {
	return { production_step, provider, model, execution: "hosted_inference" as const, token_usage: TOKEN_USAGE, external_billing: UNAVAILABLE_BILLING };
}

function legacyUsage(production_step: "main_story_write" | "main_story_copyedit" | "announcements_write" | "announcements_copyedit", input: number, output: number) {
	return {
		production_step,
		provider: "google",
		model: "gemini-3.7-flash",
		execution: "hosted_inference" as const,
		token_usage: { measurement: "reported" as const, input_tokens: input, output_tokens: output, total_tokens: input + output },
		external_billing: UNAVAILABLE_BILLING,
	};
}

function attemptUsage(
	production_step: "main_story_write" | "announcements_write",
	provider = "google",
	model = "gemini-3.7-flash",
) {
	return {
		production_step,
		provider,
		model,
		execution: "hosted_inference" as const,
		token_usage: TOKEN_USAGE,
		external_billing: UNAVAILABLE_BILLING,
	};
}

function requestProvenance(step: "main_story_write" | "announcements_write", attempt: 1 | 2) {
	return {
		transport: "cloudflare_ai_gateway_rest" as const,
		account_id: "account-id",
		gateway: { selection: "account_default" as const },
		gateway_log_id: "gateway-log-one",
		requested_model: "google/gemini-3.7-flash",
		correlation: {
			run_id: GENERATION_RUN_ID,
			invocation_id: `${GENERATION_RUN_ID}-${step}-attempt-${String(attempt)}`,
		},
		policy: {
			cache: "bypass" as const,
			log_metadata: true as const,
			log_payload: false as const,
			max_attempts: 1 as const,
			request_timeout_ms: 600000,
			request_format: "chat_completions" as const,
			response_delivery: "buffered" as const,
			structured_output: { format: "openai_chat_json_schema" as const, contract_name: step },
		},
	};
}

function createCurrentV2Status(): CurrentV2WalkGenerationRunStatus {
	return {
		contract_version: "current_v2",
		active_region_id: PAIR.active_region_id,
		publication_date: PAIR.publication_date,
		generation_run_id: GENERATION_RUN_ID,
		state: "complete",
		current_step: null,
		completed_steps: ["prepare-evidence", "main_story_write", "announcements_write", "validate-edition", "publish-edition"],
		model_usage: [
			usage("main_story_write"),
			{ ...usage("announcements_write"), request_provenance: requestProvenance("announcements_write", 1) },
		],
		model_attempts: [
			{
				production_step: "main_story_write",
				attempt: 1,
				invocation_id: `${GENERATION_RUN_ID}-main_story_write-attempt-1`,
				outcome: { status: "rejected", code: "invalid_json", message: "Writer returned invalid JSON" },
				model_usage: attemptUsage("main_story_write"),
			},
			{
				production_step: "main_story_write",
				attempt: 2,
				invocation_id: `${GENERATION_RUN_ID}-main_story_write-attempt-2`,
				outcome: { status: "accepted" },
				model_usage: attemptUsage("main_story_write"),
			},
			{
				production_step: "announcements_write",
				attempt: 1,
				invocation_id: `${GENERATION_RUN_ID}-announcements_write-attempt-1`,
				outcome: { status: "accepted" },
				model_usage: {
					...attemptUsage("announcements_write"),
					request_provenance: requestProvenance("announcements_write", 1),
				},
			},
		],
		diagnostics: [{ kind: "final_product", production_step: "main_story_write", code: "forbidden_marker", message: "forbidden token" }],
		failure: null,
		workflow: BASE_WORKFLOW,
	};
}

function createCurrentV1Status(): CurrentV1WalkGenerationRunStatus {
	return {
		contract_version: "current_v1",
		active_region_id: PAIR.active_region_id,
		publication_date: PAIR.publication_date,
		generation_run_id: GENERATION_RUN_ID,
		state: "complete",
		current_step: null,
		completed_steps: ["prepare-evidence", "main_story_write", "announcements_write", "validate-edition", "publish-edition"],
		model_usage: [usage("main_story_write"), usage("announcements_write")],
		diagnostics: [{ kind: "final_product", production_step: "main_story_write", code: "forbidden_marker", message: "forbidden token" }],
		failure: null,
		workflow: BASE_WORKFLOW,
	};
}

function createLegacyStatus(): LegacyWalkGenerationRunStatus {
	return {
		active_region_id: PAIR.active_region_id,
		publication_date: PAIR.publication_date,
		generation_run_id: GENERATION_RUN_ID,
		state: "complete",
		current_step: null,
		completed_steps: ["prepare-evidence", "main_story_write", "main_story_copyedit", "announcements_write", "announcements_copyedit", "validate-edition", "publish-edition"],
		model_usage: [
			legacyUsage("main_story_write", 100, 25),
			legacyUsage("main_story_copyedit", 60, 20),
			legacyUsage("announcements_write", 70, 15),
			legacyUsage("announcements_copyedit", 55, 10),
		],
		diagnostics: [
			{ kind: "preservation", production_step: "main_story_copyedit", code: "paragraph_count", message: "copyedit changed paragraph count" },
			{ kind: "final_product", production_step: "announcements_copyedit", code: "ungrounded_quote", message: "copyedit introduced an ungrounded quote" },
		],
		failure: null,
		workflow: BASE_WORKFLOW,
	};
}

const CURRENT_V2_STATUS = createCurrentV2Status();
const CURRENT_V1_STATUS = createCurrentV1Status();
const LEGACY_STATUS = createLegacyStatus();

void test("parses strict current_v2 status with canonical completed steps and retry attempt history", () => {
	const status = parseGenerationRunStatusResponse(JSON.stringify(CURRENT_V2_STATUS), PAIR);
	assert.ok("contract_version" in status && status.contract_version === "current_v2");
	assert.deepEqual(status.completed_steps, CURRENT_V2_STATUS.completed_steps);
	assert.deepEqual(status.model_usage, CURRENT_V2_STATUS.model_usage);
	assert.deepEqual(status.model_attempts, CURRENT_V2_STATUS.model_attempts);
});

void test("rejects leaked current_v2 retry marker steps", () => {
	const invalid: Record<string, unknown> = { ...structuredClone(CURRENT_V2_STATUS) };
	invalid["completed_steps"] = ["prepare-evidence", "main_story_write", "main_story_write_retry", "announcements_write", "validate-edition", "publish-edition"];
	assert.throws(() => parseGenerationRunStatusResponse(JSON.stringify(invalid), PAIR), /invalid completed steps|unordered completed steps/);
});

void test("rejects current_v2 attempt provenance that does not match the run and invocation identity", () => {
	const invalid = structuredClone(CURRENT_V2_STATUS);
	const attempt = invalid.model_attempts.at(2);
	if (attempt?.model_usage.request_provenance === undefined) throw new Error("Expected provenance on announcements attempt");
	attempt.model_usage.request_provenance.correlation.invocation_id = "wrong-id";
	assert.throws(() => parseGenerationRunStatusResponse(JSON.stringify(invalid), PAIR), /incoherent model attempts/);
});

void test("rejects current_v2 accepted model usage that is not derived from the accepted attempt", () => {
	const invalid = structuredClone(CURRENT_V2_STATUS);
	const acceptedUsage = invalid.model_usage.at(0);
	if (acceptedUsage === undefined) throw new Error("Expected accepted model usage");
	acceptedUsage.provider = "replacement";
	assert.throws(() => parseGenerationRunStatusResponse(JSON.stringify(invalid), PAIR), /incoherent model usage/);
});

void test("rejects current_v2 attempt model usage with a mismatched nested production step", () => {
	const invalid = structuredClone(CURRENT_V2_STATUS);
	const attempt = invalid.model_attempts.at(0);
	if (attempt === undefined) throw new Error("Expected retry attempt");
	attempt.model_usage.production_step = "announcements_write";
	assert.throws(() => parseGenerationRunStatusResponse(JSON.stringify(invalid), PAIR), /invalid model attempts/);
});

void test("parses the strict current_v1 operator status", () => {
	const status = parseGenerationRunStatusResponse(JSON.stringify(CURRENT_V1_STATUS), PAIR);
	assert.ok("contract_version" in status && status.contract_version === "current_v1");
	assert.deepEqual(status.completed_steps, CURRENT_V1_STATUS.completed_steps);
	assert.deepEqual(status.diagnostics, CURRENT_V1_STATUS.diagnostics);
});

void test("parses the strict current_v1 operator status when timestamps are present", () => {
	const status = parseGenerationRunStatusResponse(JSON.stringify({
		...CURRENT_V1_STATUS,
		created_at_utc: "2026-08-04T23:00:00.000Z",
		updated_at_utc: "2026-08-04T23:01:00.000Z",
	}), PAIR);
	assert.ok("contract_version" in status && status.contract_version === "current_v1");
	assert.deepEqual(status.completed_steps, CURRENT_V1_STATUS.completed_steps);
	assert.deepEqual(status.diagnostics, CURRENT_V1_STATUS.diagnostics);
});

void test("rejects current_v1 model attempt leakage", () => {
	const invalid: Record<string, unknown> = { ...structuredClone(CURRENT_V1_STATUS), model_attempts: structuredClone(CURRENT_V2_STATUS.model_attempts) };
	assert.throws(() => parseGenerationRunStatusResponse(JSON.stringify(invalid), PAIR), /invalid envelope/);
});

void test("rejects current_v2 operator status without retry attempt history", () => {
	const invalid: Record<string, unknown> = { ...structuredClone(CURRENT_V2_STATUS) };
	Reflect.deleteProperty(invalid, "model_attempts");
	assert.throws(() => parseGenerationRunStatusResponse(JSON.stringify(invalid), PAIR), /invalid envelope/);
});

void test("rejects legacy copyedit diagnostics in the strict current_v1 operator status", () => {
	const invalid: Record<string, unknown> = { ...structuredClone(CURRENT_V1_STATUS) };
	invalid["diagnostics"] = [{ kind: "preservation", production_step: "main_story_copyedit", code: "paragraph_count", message: "legacy preservation" }];
	assert.throws(() => parseGenerationRunStatusResponse(JSON.stringify(invalid), PAIR), /invalid diagnostic/);
});

void test("parses an untagged complete legacy operator status with copyedit diagnostics", () => {
	const status = parseGenerationRunStatusResponse(JSON.stringify(LEGACY_STATUS), PAIR);
	assert.equal(Object.hasOwn(status, "contract_version"), false);
	assert.deepEqual(status.completed_steps, LEGACY_STATUS.completed_steps);
	assert.deepEqual(status.diagnostics, LEGACY_STATUS.diagnostics);
});

void test("rejects an untagged five-step body instead of accepting it as current", () => {
	const invalid: Record<string, unknown> = { ...structuredClone(CURRENT_V1_STATUS) };
	Reflect.deleteProperty(invalid, "contract_version");
	invalid["diagnostics"] = [];
	assert.throws(() => parseGenerationRunStatusResponse(JSON.stringify(invalid), PAIR), /unordered completed steps/);
});
