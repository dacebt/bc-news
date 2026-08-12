import { expect, test } from "vitest";
import {
	ModelRuntimeEvidenceSchema,
	RuntimeNonnegativeIntegerObservationSchema,
	ModelUsageRecordSchema,
	modelUsageRecord,
	observedMeasurement,
	observedNonnegativeInteger,
	observedPositiveInteger,
	observedString,
} from "../src/index";

const unknownString = { state: "unknown" as const, reason: "not_reported" as const };
const unknownInteger = { state: "unknown" as const, reason: "not_reported" as const };
const identity = {
	requested_identity: unknownString,
	identifier: unknownString,
	model_key: unknownString,
	path: unknownString,
	display_name: unknownString,
	format: unknownString,
	instance_reference: unknownString,
	size_bytes: unknownInteger,
	architecture: unknownString,
	parameter_count_description: unknownString,
	quantization_name: unknownString,
	quantization_bits: { state: "unknown" as const, reason: "not_reported" as const },
	vision_capable: { state: "unknown" as const, reason: "not_reported" as const },
	trained_for_tool_use: { state: "unknown" as const, reason: "not_reported" as const },
};

function runtimeEvidenceCandidate(speculativeTotal: number) {
	return {
		execution_context: {
			client_sdk_release: unknownString,
			provider_runtime_identity: unknownString,
			provider_runtime_version: unknownString,
			provider_runtime_build: unknownInteger,
			provider_service_tier: unknownString,
			selected_model: identity,
			response_model: identity,
			context_length: { state: "unknown" as const, reason: "not_reported" as const },
			requested_reasoning_posture: unknownString,
			effective_reasoning_setting: unknownString,
			speculative_draft_model_identity: unknownString,
		},
		prediction_observation: {
			provider_response_id: unknownString,
			stop_reason: unknownString,
			time_to_first_token_ms: unknownString,
			total_time_ms: unknownString,
			tokens_per_second: unknownString,
			speculative_total_tokens: { state: "observed" as const, value: speculativeTotal },
			speculative_accepted_tokens: { state: "observed" as const, value: 4 },
			speculative_rejected_tokens: { state: "observed" as const, value: 3 },
			speculative_ignored_tokens: { state: "observed" as const, value: 2 },
			reasoning_content_present: { state: "observed" as const, value: false },
		},
	};
}

test("normalizes invalid external observations without nulls, non-finite numbers, or guessed prose", () => {
	expect(observedString(" ")).toEqual({ state: "unknown", reason: "not_reported" });
	expect(observedNonnegativeInteger(-1)).toEqual({ state: "unknown", reason: "not_reported" });
	expect(observedNonnegativeInteger(1.5)).toEqual({ state: "unknown", reason: "not_reported" });
	expect(observedPositiveInteger(0)).toEqual({ state: "unknown", reason: "not_reported" });
	expect(observedMeasurement(Number.NaN)).toEqual({ state: "unknown", reason: "not_reported" });
	expect(RuntimeNonnegativeIntegerObservationSchema.safeParse({ state: "observed", value: null }).success).toBe(false);
	expect(RuntimeNonnegativeIntegerObservationSchema.safeParse({ state: "unknown", reason: "provider_controlled" }).success).toBe(false);
	expect(RuntimeNonnegativeIntegerObservationSchema.safeParse({ state: "externally_controlled", reason: "not_reported" }).success).toBe(false);
	expect(RuntimeNonnegativeIntegerObservationSchema.safeParse({ state: "externally_controlled", reason: "observation_failed" }).success).toBe(false);
	expect(RuntimeNonnegativeIntegerObservationSchema.safeParse({ state: "externally_controlled", reason: "not_applicable" }).success).toBe(false);
});

test("keeps runtime evidence out of model usage while preserving request provenance", () => {
	const record = modelUsageRecord("main_story_write", {
		text: "completion",
		provider: "provider",
		model: "model",
		execution: "hosted_inference",
		token_usage: { measurement: "reported", input_tokens: 1, output_tokens: 2, total_tokens: 3 },
		external_billing: { classification: "unavailable", reason: "provider_did_not_report_cost" },
		request_provenance: {
			transport: "cloudflare_ai_gateway_rest",
			account_id: "account-id",
			gateway: { selection: "account_default" },
			gateway_log_id: "gateway-log-id",
			requested_model: "openai/model",
			correlation: { run_id: "run-id", invocation_id: "invocation-id" },
			policy: { cache: "bypass", log_metadata: true, log_payload: false, max_attempts: 1, request_timeout_ms: 600_000 },
		},
		runtime_evidence: ModelRuntimeEvidenceSchema.parse(runtimeEvidenceCandidate(9)),
	});
	expect(record).not.toHaveProperty("runtime_evidence");
	expect(record.request_provenance?.gateway_log_id).toBe("gateway-log-id");
	expect(ModelUsageRecordSchema.parse(record)).toEqual(record);
});

test("rejects inconsistent complete speculative token evidence", () => {
	expect(ModelRuntimeEvidenceSchema.safeParse(runtimeEvidenceCandidate(10)).success).toBe(false);
});
