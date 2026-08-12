import { createHash } from "node:crypto";
import { z } from "zod";
import {
	V1EvalConfigSchema,
	V1ExternalBillingSchema,
	V1ProductionModelStepSchema,
	V1Sha256HashSchema,
	V1TokenUsageSchema,
	type V1ProductionModelStep,
} from "./evaluation-artifact-v1-contracts";

export const EvaluationTimestampSchema = z.iso.datetime({ offset: true });
export const EvaluationIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/u);

export function sha256Json(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function canonical(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonical);
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(Object.entries(value)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, item]) => [key, canonical(item)]));
	}
	return value;
}

export function canonicallyEqual(left: unknown, right: unknown): boolean {
	return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

export function evaluationConfigIdentity(config: {
	readonly production_steps: Record<V1ProductionModelStep, object>;
}): string {
	return `config-${sha256Json(config)}`;
}

export const EvaluationFindingSchema = z.strictObject({
	kind: z.enum(["invalid_json", "contract_mismatch", "preservation", "final_product"]),
	production_step: V1ProductionModelStepSchema,
	code: z.string().min(1),
	message: z.string().min(1),
});

const RetainedRequestSchema = z.strictObject({
	production_step: V1ProductionModelStepSchema,
	system: z.string(),
	user: z.string(),
});

const ModelCompletionSchema = z.strictObject({
	text: z.string(),
	provider: z.string().min(1),
	model: z.string().min(1),
	execution: z.enum(["recorded_replay", "local_inference", "hosted_inference"]),
	token_usage: V1TokenUsageSchema,
	external_billing: V1ExternalBillingSchema,
});

const ParsePendingSchema = z.strictObject({ state: z.literal("pending") });
const ParseSucceededSchema = z.strictObject({ state: z.literal("succeeded"), output: z.record(z.string(), z.unknown()) });
const ParseRejectedSchema = z.strictObject({ state: z.literal("rejected"), findings: z.array(EvaluationFindingSchema).min(1) });
const ParseStateSchema = z.discriminatedUnion("state", [ParsePendingSchema, ParseSucceededSchema, ParseRejectedSchema]);

export const TransportFailureDetailsSchema = z.strictObject({
	contract: z.string().min(1),
	issues: z.array(z.strictObject({
		path: z.array(z.union([z.string(), z.number().int().nonnegative()])),
		code: z.string().min(1),
		expected: z.string().min(1).optional(),
		received_type: z.enum(["array", "boolean", "null", "number", "object", "string", "undefined"]).optional(),
		unexpected_keys: z.array(z.string()).min(1).optional(),
	})).min(1),
});

export type TransportFailureDetails = z.infer<typeof TransportFailureDetailsSchema>;

const InvocationBase = {
	id: EvaluationIdSchema,
	production_step: V1ProductionModelStepSchema,
	config_identity: EvaluationIdSchema,
	ordinal: z.number().int().positive(),
	predecessor_invocation_id: EvaluationIdSchema.nullable(),
	request: RetainedRequestSchema,
	request_sha256: V1Sha256HashSchema,
	started_at: EvaluationTimestampSchema,
};

const InFlightInvocationSchema = z.strictObject({ ...InvocationBase, transport: z.literal("in_flight"), parse: ParsePendingSchema });
const SucceededInvocationSchema = z.strictObject({
	...InvocationBase, transport: z.literal("succeeded"), completion: ModelCompletionSchema,
	ended_at: EvaluationTimestampSchema, duration_ms: z.number().int().nonnegative(), parse: ParseStateSchema,
});
const FailedInvocationSchema = z.strictObject({
	...InvocationBase, transport: z.literal("failed"),
	failure: z.strictObject({
		code: z.string().min(1),
		message: z.string().min(1),
		details: TransportFailureDetailsSchema.optional(),
	}),
	ended_at: EvaluationTimestampSchema, duration_ms: z.number().int().nonnegative(),
	retry_classification: z.discriminatedUnion("state", [
		z.strictObject({ state: z.literal("pending") }),
		z.strictObject({ state: z.literal("classified"), eligible: z.boolean(), reason: z.string().min(1) }),
	]),
	parse: ParsePendingSchema,
});

export const StepInvocationSchema = z.discriminatedUnion("transport", [InFlightInvocationSchema, SucceededInvocationSchema, FailedInvocationSchema]).superRefine((invocation, context) => {
	if (invocation.request.production_step !== invocation.production_step) context.addIssue({ code: "custom", path: ["request", "production_step"], message: "retained request must name the invocation production step" });
	if (invocation.request_sha256 !== sha256Json(invocation.request)) context.addIssue({ code: "custom", path: ["request_sha256"], message: "request hash must bind the exact retained request" });
	if (invocation.transport !== "in_flight") {
		const startedAt = Date.parse(invocation.started_at);
		const endedAt = Date.parse(invocation.ended_at);
		if (endedAt < startedAt) context.addIssue({ code: "custom", path: ["ended_at"], message: "ended invocation cannot end before it starts" });
		if (invocation.duration_ms !== endedAt - startedAt) context.addIssue({ code: "custom", path: ["duration_ms"], message: "duration must exactly equal the retained invocation endpoint difference" });
	}
});

export const SubjectOutcomeSchema = z.enum(["completed", "parse_rejected", "contract_rejected", "preservation_rejected", "final_product_rejected", "infrastructure_incomplete"]);

const TrackStateSchema = z.strictObject({
	lifecycle: z.enum(["pending", "running", "completed", "rejected"]),
	subject_outcome: SubjectOutcomeSchema.nullable(),
	terminal_production_step: V1ProductionModelStepSchema.nullable(),
	product: z.record(z.string(), z.unknown()).nullable(),
	findings: z.array(EvaluationFindingSchema),
});

const SelectedInvocationIdsSchema = z.strictObject({
	main_story_write: EvaluationIdSchema.nullable(), main_story_copyedit: EvaluationIdSchema.nullable(),
	announcements_write: EvaluationIdSchema.nullable(), announcements_copyedit: EvaluationIdSchema.nullable(),
});

export const EvaluationTrialSchema = z.strictObject({
	id: EvaluationIdSchema, config_identity: EvaluationIdSchema, repetition: z.literal(1),
	lifecycle: z.enum(["running", "complete"]), started_at: EvaluationTimestampSchema,
	completed_at: EvaluationTimestampSchema.nullable(), subject_outcome: SubjectOutcomeSchema.nullable(),
	tracks: z.strictObject({ main_story: TrackStateSchema, announcements: TrackStateSchema }),
	selected_invocation_ids: SelectedInvocationIdsSchema, invocations: z.array(StepInvocationSchema),
});

export const EvaluationTrialV2Schema = EvaluationTrialSchema.extend({
	repetition: z.number().int().positive(),
});

export const SubjectOutcomeCountsSchema = z.strictObject(Object.fromEntries(
	SubjectOutcomeSchema.options.map((outcome) => [outcome, z.number().int().nonnegative()]),
) as Record<(typeof SubjectOutcomeSchema.options)[number], z.ZodNumber>);

export const EvaluationCodeProvenanceSchema = z.strictObject({
	repository: z.literal("bc-news"), commit_sha: z.string().regex(/^[0-9a-f]{40}$/u), dirty: z.literal(false),
});

export const OutputContractProvenanceSchema = z.strictObject({
	production_step: V1ProductionModelStepSchema, canonical_schema: z.json(), schema_sha256: V1Sha256HashSchema,
});

export const BenchmarkRunBaseSchema = z.strictObject({
	version: z.literal(1), id: EvaluationIdSchema, lifecycle: z.enum(["running", "complete"]),
	started_at: EvaluationTimestampSchema, completed_at: EvaluationTimestampSchema.nullable(),
	declaration: z.strictObject({ configurations: z.tuple([z.strictObject({ identity: EvaluationIdSchema, config: V1EvalConfigSchema })]), repetition_count: z.literal(1) }),
	fixture: z.strictObject({ path: z.string().min(1), fixture_sha256: V1Sha256HashSchema }),
	prepared_evidence: z.unknown(),
	provenance: z.strictObject({ code: EvaluationCodeProvenanceSchema, output_contracts: z.tuple([OutputContractProvenanceSchema, OutputContractProvenanceSchema, OutputContractProvenanceSchema, OutputContractProvenanceSchema]) }),
	trial_roster: z.tuple([z.strictObject({ trial_id: EvaluationIdSchema, config_identity: EvaluationIdSchema, repetition: z.literal(1) })]),
	trials: z.array(EvaluationTrialSchema).length(1), outcome_counts: SubjectOutcomeCountsSchema,
	harness_outcome: z.enum(["pending", "retained"]),
});

export type EvaluationFinding = z.infer<typeof EvaluationFindingSchema>;
export type StepInvocation = z.infer<typeof StepInvocationSchema>;
export type V1EvaluationTrial = z.infer<typeof EvaluationTrialSchema>;
export type EvaluationTrial = z.infer<typeof EvaluationTrialV2Schema>;
export type EvaluationTrialV2 = EvaluationTrial;
export type SubjectOutcome = z.infer<typeof SubjectOutcomeSchema>;
