import { z } from "zod";
import {
	observedString,
	type ModelRuntimeEvidence,
	type ModelRuntimeIdentity,
} from "@bc-news/generation-core";

const NonBlankExactStringSchema = z.string().min(1).refine((value) => value.trim().length > 0);

const UsageSchema = z.looseObject({
	prompt_tokens: z.int().nonnegative(),
	completion_tokens: z.int().nonnegative(),
	total_tokens: z.int().nonnegative(),
}).refine((usage) => usage.total_tokens === usage.prompt_tokens + usage.completion_tokens);

const ChoiceSchema = z.looseObject({
	message: z.looseObject({
		content: NonBlankExactStringSchema.nullable(),
	}),
	finish_reason: z.string().nullable().optional(),
});

export const CloudflareChatCompletionSchema = z.looseObject({
	id: NonBlankExactStringSchema.optional(),
	model: NonBlankExactStringSchema,
	choices: z.tuple([ChoiceSchema]).rest(z.unknown()),
	usage: UsageSchema,
	service_tier: z.string().nullable().optional(),
	system_fingerprint: z.string().nullable().optional(),
});

export type CloudflareChatCompletion = z.infer<typeof CloudflareChatCompletionSchema>;

const unknownString = { state: "unknown" as const, reason: "not_reported" as const };
const unknownInteger = { state: "unknown" as const, reason: "not_reported" as const };
const unknownMeasurement = { state: "unknown" as const, reason: "not_reported" as const };
const providerControlledString = { state: "externally_controlled" as const, reason: "provider_controlled" as const };
const providerControlledInteger = { state: "externally_controlled" as const, reason: "provider_controlled" as const };
const providerControlledMeasurement = { state: "externally_controlled" as const, reason: "provider_controlled" as const };
const providerControlledBoolean = { state: "externally_controlled" as const, reason: "provider_controlled" as const };

function gatewayModelIdentity(requestedModel: string, responseModel?: string): ModelRuntimeIdentity {
	return {
		requested_identity: observedString(requestedModel),
		identifier: responseModel === undefined ? providerControlledString : observedString(responseModel),
		model_key: providerControlledString,
		path: providerControlledString,
		display_name: providerControlledString,
		format: providerControlledString,
		instance_reference: providerControlledString,
		size_bytes: providerControlledInteger,
		architecture: providerControlledString,
		parameter_count_description: providerControlledString,
		quantization_name: providerControlledString,
		quantization_bits: providerControlledMeasurement,
		vision_capable: providerControlledBoolean,
		trained_for_tool_use: providerControlledBoolean,
	};
}

export function cloudflareChatCompletionsRuntimeEvidence(
	requestedModel: string,
	completion: CloudflareChatCompletion,
): ModelRuntimeEvidence {
	return {
		execution_context: {
			client_sdk_release: { state: "unknown", reason: "not_applicable" },
			provider_runtime_identity: observedString(completion.system_fingerprint),
			provider_runtime_version: providerControlledString,
			provider_runtime_build: providerControlledInteger,
			provider_service_tier: observedString(completion.service_tier),
			selected_model: gatewayModelIdentity(requestedModel),
			response_model: gatewayModelIdentity(requestedModel, completion.model),
			context_length: { state: "externally_controlled", reason: "provider_controlled" },
			requested_reasoning_posture: { state: "observed", value: "provider_default" },
			effective_reasoning_setting: providerControlledString,
			speculative_draft_model_identity: unknownString,
		},
		prediction_observation: {
			provider_response_id: observedString(completion.id),
			stop_reason: observedString(completion.choices[0].finish_reason),
			time_to_first_token_ms: unknownMeasurement,
			total_time_ms: unknownMeasurement,
			tokens_per_second: unknownMeasurement,
			speculative_total_tokens: unknownInteger,
			speculative_accepted_tokens: unknownInteger,
			speculative_rejected_tokens: unknownInteger,
			speculative_ignored_tokens: unknownInteger,
			reasoning_content_present: { state: "unknown", reason: "not_reported" },
		},
	};
}
