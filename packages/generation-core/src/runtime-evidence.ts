import { z } from "zod";

export const RUNTIME_OBSERVATION_REASONS = [
	"not_reported",
	"observation_failed",
	"provider_controlled",
	"not_applicable",
] as const;

export const RuntimeObservationReasonSchema = z.enum(RUNTIME_OBSERVATION_REASONS);
const UnknownObservationReasonSchema = z.enum([
	"not_reported",
	"observation_failed",
	"not_applicable",
]);
const ExternallyControlledObservationReasonSchema = z.literal("provider_controlled");

function runtimeObservationSchema<T extends z.ZodType>(value: T) {
	return z.discriminatedUnion("state", [
		z.strictObject({ state: z.literal("observed"), value }),
		z.strictObject({ state: z.literal("unknown"), reason: UnknownObservationReasonSchema }),
		z.strictObject({ state: z.literal("externally_controlled"), reason: ExternallyControlledObservationReasonSchema }),
	]);
}

const NonBlankStringSchema = z.string().trim().min(1);
const NonnegativeIntegerSchema = z.number().int().nonnegative();
const PositiveIntegerSchema = z.number().int().positive();
const NonnegativeMeasurementSchema = z.number().finite().nonnegative();

export const RuntimeStringObservationSchema = runtimeObservationSchema(NonBlankStringSchema);
export const RuntimeNonnegativeIntegerObservationSchema = runtimeObservationSchema(NonnegativeIntegerSchema);
export const RuntimePositiveIntegerObservationSchema = runtimeObservationSchema(PositiveIntegerSchema);
export const RuntimeMeasurementObservationSchema = runtimeObservationSchema(NonnegativeMeasurementSchema);
export const RuntimeBooleanObservationSchema = runtimeObservationSchema(z.boolean());

export const ModelRuntimeIdentitySchema = z.strictObject({
	requested_identity: RuntimeStringObservationSchema,
	identifier: RuntimeStringObservationSchema,
	model_key: RuntimeStringObservationSchema,
	path: RuntimeStringObservationSchema,
	display_name: RuntimeStringObservationSchema,
	format: RuntimeStringObservationSchema,
	instance_reference: RuntimeStringObservationSchema,
	size_bytes: RuntimeNonnegativeIntegerObservationSchema,
	architecture: RuntimeStringObservationSchema,
	parameter_count_description: RuntimeStringObservationSchema,
	quantization_name: RuntimeStringObservationSchema,
	quantization_bits: RuntimeMeasurementObservationSchema,
	vision_capable: RuntimeBooleanObservationSchema,
	trained_for_tool_use: RuntimeBooleanObservationSchema,
});

export const AppliedInferenceConfigurationSchema = z.strictObject({
	temperature: RuntimeMeasurementObservationSchema,
	top_p: RuntimeMeasurementObservationSchema,
	top_k: RuntimePositiveIntegerObservationSchema,
	thinking_enabled: RuntimeBooleanObservationSchema,
});

export const ModelExecutionContextSchema = z.strictObject({
	client_sdk_release: RuntimeStringObservationSchema,
	provider_runtime_identity: RuntimeStringObservationSchema,
	provider_runtime_version: RuntimeStringObservationSchema,
	provider_runtime_build: RuntimeNonnegativeIntegerObservationSchema,
	provider_service_tier: RuntimeStringObservationSchema,
	selected_model: ModelRuntimeIdentitySchema,
	response_model: ModelRuntimeIdentitySchema,
	context_length: RuntimePositiveIntegerObservationSchema,
	requested_reasoning_posture: RuntimeStringObservationSchema,
	effective_reasoning_setting: RuntimeStringObservationSchema,
	speculative_draft_model_identity: RuntimeStringObservationSchema,
	applied_inference_configuration: AppliedInferenceConfigurationSchema.optional(),
});

export const ModelPredictionObservationSchema = z.strictObject({
	provider_response_id: RuntimeStringObservationSchema,
	stop_reason: RuntimeStringObservationSchema,
	time_to_first_token_ms: RuntimeMeasurementObservationSchema,
	total_time_ms: RuntimeMeasurementObservationSchema,
	tokens_per_second: RuntimeMeasurementObservationSchema,
	speculative_total_tokens: RuntimeNonnegativeIntegerObservationSchema,
	speculative_accepted_tokens: RuntimeNonnegativeIntegerObservationSchema,
	speculative_rejected_tokens: RuntimeNonnegativeIntegerObservationSchema,
	speculative_ignored_tokens: RuntimeNonnegativeIntegerObservationSchema,
	reasoning_content_present: RuntimeBooleanObservationSchema,
}).superRefine((observation, context) => {
	const counts = [
		observation.speculative_total_tokens,
		observation.speculative_accepted_tokens,
		observation.speculative_rejected_tokens,
		observation.speculative_ignored_tokens,
	];
	if (!counts.every((count) => count.state === "observed")) return;
	const total = observation.speculative_total_tokens.state === "observed" ? observation.speculative_total_tokens.value : 0;
	const accepted = observation.speculative_accepted_tokens.state === "observed" ? observation.speculative_accepted_tokens.value : 0;
	const rejected = observation.speculative_rejected_tokens.state === "observed" ? observation.speculative_rejected_tokens.value : 0;
	const ignored = observation.speculative_ignored_tokens.state === "observed" ? observation.speculative_ignored_tokens.value : 0;
	if (total !== accepted + rejected + ignored) {
		context.addIssue({
			code: "custom",
			path: ["speculative_total_tokens"],
			message: "speculative total must equal accepted plus rejected plus ignored when all counts are observed",
		});
	}
});

export const ModelRuntimeEvidenceSchema = z.strictObject({
	execution_context: ModelExecutionContextSchema,
	prediction_observation: ModelPredictionObservationSchema,
});

export type RuntimeObservationReason = z.infer<typeof RuntimeObservationReasonSchema>;
export type RuntimeStringObservation = z.infer<typeof RuntimeStringObservationSchema>;
export type RuntimeNonnegativeIntegerObservation = z.infer<typeof RuntimeNonnegativeIntegerObservationSchema>;
export type RuntimePositiveIntegerObservation = z.infer<typeof RuntimePositiveIntegerObservationSchema>;
export type RuntimeMeasurementObservation = z.infer<typeof RuntimeMeasurementObservationSchema>;
export type RuntimeBooleanObservation = z.infer<typeof RuntimeBooleanObservationSchema>;
export type ModelRuntimeIdentity = z.infer<typeof ModelRuntimeIdentitySchema>;
export type AppliedInferenceConfiguration = z.infer<typeof AppliedInferenceConfigurationSchema>;
export type ModelExecutionContext = z.infer<typeof ModelExecutionContextSchema>;
export type ModelPredictionObservation = z.infer<typeof ModelPredictionObservationSchema>;
export type ModelRuntimeEvidence = z.infer<typeof ModelRuntimeEvidenceSchema>;

export function observedString(value: unknown): RuntimeStringObservation {
	const parsed = NonBlankStringSchema.safeParse(value);
	return parsed.success ? { state: "observed", value: parsed.data } : { state: "unknown", reason: "not_reported" };
}

export function observedNonnegativeInteger(value: unknown): RuntimeNonnegativeIntegerObservation {
	const parsed = NonnegativeIntegerSchema.safeParse(value);
	return parsed.success ? { state: "observed", value: parsed.data } : { state: "unknown", reason: "not_reported" };
}

export function observedPositiveInteger(value: unknown): RuntimePositiveIntegerObservation {
	const parsed = PositiveIntegerSchema.safeParse(value);
	return parsed.success ? { state: "observed", value: parsed.data } : { state: "unknown", reason: "not_reported" };
}

export function observedMeasurement(value: unknown): RuntimeMeasurementObservation {
	const parsed = NonnegativeMeasurementSchema.safeParse(value);
	return parsed.success ? { state: "observed", value: parsed.data } : { state: "unknown", reason: "not_reported" };
}
