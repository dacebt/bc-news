import { z } from "zod";
import { ModelRuntimeEvidenceSchema } from "@bc-news/generation-core";
import { V6BenchmarkRunBaseSchema, V6BenchmarkRunSchema } from "./evaluation-artifact-v6";
import { EvaluationIdSchema } from "./evaluation-artifact-schemas";
import { V1ProductionModelStepSchema } from "./evaluation-artifact-v1-contracts";

const RuntimeEvidenceIdentitySchema = z.strictObject({
	trial_id: EvaluationIdSchema,
	invocation_id: EvaluationIdSchema,
	config_identity: EvaluationIdSchema,
	production_step: V1ProductionModelStepSchema,
	ordinal: z.number().int().positive(),
});

export const PendingRuntimeEvidenceSchema = z.strictObject({
	...RuntimeEvidenceIdentitySchema.shape,
	state: z.literal("pending"),
});

export const UnavailableRuntimeEvidenceSchema = z.strictObject({
	...RuntimeEvidenceIdentitySchema.shape,
	state: z.literal("unavailable"),
	reason: z.enum(["transport_failed"]),
});

export const CapturedRuntimeEvidenceSchema = z.strictObject({
	...RuntimeEvidenceIdentitySchema.shape,
	state: z.literal("captured"),
	evidence: ModelRuntimeEvidenceSchema,
});

export const RuntimeEvidenceRecordSchema = z.discriminatedUnion("state", [
	PendingRuntimeEvidenceSchema,
	UnavailableRuntimeEvidenceSchema,
	CapturedRuntimeEvidenceSchema,
]);

export const V7BenchmarkRunBaseSchema = V6BenchmarkRunBaseSchema.omit({ version: true }).extend({
	version: z.literal(7),
	runtime_evidence: z.array(RuntimeEvidenceRecordSchema),
});

export const V7BenchmarkRunSchema = V7BenchmarkRunBaseSchema.superRefine((run, context) => {
	const legacyCandidate = { ...run, version: 6 } as Record<string, unknown>;
	delete legacyCandidate.runtime_evidence;
	const legacy = V6BenchmarkRunSchema.safeParse(legacyCandidate);
	if (!legacy.success) {
		for (const issue of legacy.error.issues) {
			context.addIssue({
				code: "custom",
				path: issue.path,
				message: `artifact version 7 must preserve the version 6 benchmark invariant: ${issue.message}`,
			});
		}
	}

	const expected = run.trials.flatMap((trial) => trial.invocations.map((invocation) => ({
		trial_id: trial.id,
		invocation_id: invocation.id,
		config_identity: invocation.config_identity,
		production_step: invocation.production_step,
		ordinal: invocation.ordinal,
		transport: invocation.transport,
	})));
	if (run.runtime_evidence.length !== expected.length) {
		context.addIssue({
			code: "custom",
			path: ["runtime_evidence"],
			message: "runtime-evidence roster must contain exactly one entry for every retained invocation",
		});
	}
	const invocationIds = new Set<string>();
	for (const [index, evidence] of run.runtime_evidence.entries()) {
		const invocation = expected[index];
		if (invocation === undefined
			|| evidence.trial_id !== invocation.trial_id
			|| evidence.invocation_id !== invocation.invocation_id
			|| evidence.config_identity !== invocation.config_identity
			|| evidence.production_step !== invocation.production_step
			|| evidence.ordinal !== invocation.ordinal) {
			context.addIssue({
				code: "custom",
				path: ["runtime_evidence", index],
				message: "runtime-evidence roster must preserve trial-roster order then invocation ordinal and match invocation identity",
			});
		}
		if (invocationIds.has(evidence.invocation_id)) {
			context.addIssue({ code: "custom", path: ["runtime_evidence", index, "invocation_id"], message: "runtime-evidence invocation ids must be unique" });
		}
		invocationIds.add(evidence.invocation_id);
		if (invocation?.transport === "in_flight" && evidence.state !== "pending") {
			context.addIssue({ code: "custom", path: ["runtime_evidence", index, "state"], message: "in-flight invocation runtime evidence must be pending" });
		}
		if (invocation?.transport === "failed" && evidence.state !== "unavailable") {
			context.addIssue({ code: "custom", path: ["runtime_evidence", index, "state"], message: "failed invocation runtime evidence must be unavailable" });
		}
		if (invocation?.transport === "succeeded" && evidence.state !== "captured") {
			context.addIssue({ code: "custom", path: ["runtime_evidence", index, "state"], message: "succeeded invocation runtime evidence must be captured" });
		}
		if (invocation?.transport === "succeeded" && evidence.state === "captured") {
			const reasoningPosture = evidence.evidence.execution_context.requested_reasoning_posture;
			if (reasoningPosture.state !== "observed" || reasoningPosture.value !== "provider_default") {
				context.addIssue({ code: "custom", path: ["runtime_evidence", index, "evidence", "execution_context", "requested_reasoning_posture"], message: "captured requested reasoning posture must be observed provider_default" });
			}
			const retainedInvocation = run.trials.flatMap(({ invocations }) => invocations)
				.find(({ id }) => id === invocation.invocation_id);
			const responseIdentity = evidence.evidence.execution_context.response_model.identifier;
			if (retainedInvocation?.transport === "succeeded"
				&& (responseIdentity.state !== "observed" || responseIdentity.value !== retainedInvocation.completion.model)) {
				context.addIssue({ code: "custom", path: ["runtime_evidence", index, "evidence", "execution_context", "response_model", "identifier"], message: "captured response-model identity must equal the retained completion model" });
			}
			const declaration = run.declaration.configurations.find(({ identity }) => identity === evidence.config_identity);
			const adapter = declaration?.config.production_steps[evidence.production_step];
			const requestedIdentity = evidence.evidence.execution_context.selected_model.requested_identity;
			if (adapter !== undefined && adapter.adapter !== "recorded"
				&& (requestedIdentity.state !== "observed" || requestedIdentity.value !== adapter.model)) {
				context.addIssue({ code: "custom", path: ["runtime_evidence", index, "evidence", "execution_context", "selected_model", "requested_identity"], message: "captured selected-model request identity must equal the declared adapter model" });
			}
		}
	}
});

export type RuntimeEvidenceRecord = z.infer<typeof RuntimeEvidenceRecordSchema>;
export type V7EvaluationTrial = z.infer<typeof V7BenchmarkRunSchema>["trials"][number];
export type V7BenchmarkRun = z.infer<typeof V7BenchmarkRunSchema>;
