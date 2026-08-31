import { z } from "zod";
import type { GenerationRunParams } from "@bc-news/contracts";
import {
	PersistedModelUsageRecordSchema,
	PRODUCTION_MODEL_STEPS,
	ProductionModelStepSchema,
} from "@bc-news/generation-core";
import { generationRunAttemptInvocationId, generationRunInstanceId } from "./generation-run-instance-id";

const ModelAttemptOrdinalSchema = z.union([z.literal(1), z.literal(2)]);

const AcceptedModelAttemptOutcomeSchema = z.strictObject({
	status: z.literal("accepted"),
});

const RejectedModelAttemptOutcomeSchema = z.strictObject({
	status: z.literal("rejected"),
	code: z.enum(["invalid_json", "contract_mismatch"]),
	message: z.string().trim().min(1),
});

export const ModelAttemptOutcomeSchema = z.discriminatedUnion("status", [
	AcceptedModelAttemptOutcomeSchema,
	RejectedModelAttemptOutcomeSchema,
]);

export const CurrentModelAttemptRecordSchema = z
	.strictObject({
		production_step: ProductionModelStepSchema,
		attempt: ModelAttemptOrdinalSchema,
		invocation_id: z.string().trim().min(1),
		outcome: ModelAttemptOutcomeSchema,
		model_usage: PersistedModelUsageRecordSchema,
	})
	.superRefine((attempt, context) => {
		if (attempt.model_usage.production_step !== attempt.production_step) {
			context.addIssue({
				code: "custom",
				path: ["model_usage", "production_step"],
				message: "attempt model usage must match the attempt production step",
			});
		}
	});

type CurrentModelAttemptRecord = z.infer<typeof CurrentModelAttemptRecordSchema>;
type CurrentModelAttemptOutcome = z.infer<typeof ModelAttemptOutcomeSchema>;
type ModelRequestProvenance = CurrentModelAttemptRecord["model_usage"]["request_provenance"];

function sameRequestProvenance(
	left: ModelRequestProvenance | undefined,
	right: ModelRequestProvenance | undefined,
): boolean {
	return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function sameModelUsageRecord(
	left: CurrentModelAttemptRecord["model_usage"],
	right: CurrentModelAttemptRecord["model_usage"],
): boolean {
	return (
		left.production_step === right.production_step &&
		left.provider === right.provider &&
		left.model === right.model &&
		left.execution === right.execution &&
		JSON.stringify(left.token_usage) === JSON.stringify(right.token_usage) &&
		JSON.stringify(left.external_billing) === JSON.stringify(right.external_billing) &&
		sameRequestProvenance(left.request_provenance, right.request_provenance)
	);
}

export function sameModelAttemptRecord(
	left: CurrentModelAttemptRecord,
	right: CurrentModelAttemptRecord,
): boolean {
	return (
		left.production_step === right.production_step &&
		left.attempt === right.attempt &&
		left.invocation_id === right.invocation_id &&
		JSON.stringify(left.outcome) === JSON.stringify(right.outcome) &&
		sameModelUsageRecord(left.model_usage, right.model_usage)
	);
}

export function validateCurrentModelAttemptProjection(params: GenerationRunParams, projection: {
	state: "queued" | "running" | "complete" | "errored";
	current_step: string | null;
	completed_steps: readonly string[];
	model_usage: readonly z.infer<typeof PersistedModelUsageRecordSchema>[];
	model_attempts: readonly CurrentModelAttemptRecord[];
	failure: { step: string } | null;
}, context: z.RefinementCtx): void {
	if (projection.state === "queued" && projection.model_attempts.length > 0) {
		context.addIssue({ code: "custom", message: "queued runs cannot retain model attempts" });
	}

	const attemptsByStep = new Map<string, CurrentModelAttemptRecord[]>();
	const seenInvocationIds = new Set<string>();
	let previousStepIndex = -1;
	for (const [index, attempt] of projection.model_attempts.entries()) {
		const stepIndex = PRODUCTION_MODEL_STEPS.indexOf(attempt.production_step);
		if (stepIndex < previousStepIndex) {
			context.addIssue({
				code: "custom",
				path: ["model_attempts", index],
				message: "model attempts must follow writer order",
			});
		}
		previousStepIndex = stepIndex;

		if (seenInvocationIds.has(attempt.invocation_id)) {
			context.addIssue({
				code: "custom",
				path: ["model_attempts", index, "invocation_id"],
				message: "model attempt invocation ids must be unique",
			});
		}
		seenInvocationIds.add(attempt.invocation_id);

		const expectedInvocationId = generationRunAttemptInvocationId(
			params,
			attempt.production_step,
			attempt.attempt,
		);
		if (attempt.invocation_id !== expectedInvocationId) {
			context.addIssue({
				code: "custom",
				path: ["model_attempts", index, "invocation_id"],
				message: "model attempt invocation id must be deterministic",
			});
		}
		const correlation = attempt.model_usage.request_provenance?.correlation;
		if (correlation !== undefined) {
			if (correlation.run_id !== generationRunInstanceId(params)) {
				context.addIssue({
					code: "custom",
					path: ["model_attempts", index, "model_usage", "request_provenance", "correlation", "run_id"],
					message: "model attempt correlation run_id must match the generation run id",
				});
			}
			if (correlation.invocation_id !== attempt.invocation_id) {
				context.addIssue({
					code: "custom",
					path: ["model_attempts", index, "model_usage", "request_provenance", "correlation", "invocation_id"],
					message: "model attempt correlation invocation_id must match the attempt invocation id",
				});
			}
		}

		const stepAttempts = attemptsByStep.get(attempt.production_step) ?? [];
		if (stepAttempts.length >= 2) {
			context.addIssue({
				code: "custom",
				path: ["model_attempts", index],
				message: "each writer may retain at most two attempts",
			});
		}
		const expectedAttempt = stepAttempts.length + 1;
		if (attempt.attempt !== expectedAttempt) {
			context.addIssue({
				code: "custom",
				path: ["model_attempts", index, "attempt"],
				message: "writer attempts must start at 1 and increment by 1",
			});
		}
		if (stepAttempts.at(-1)?.outcome.status === "accepted") {
			context.addIssue({
				code: "custom",
				path: ["model_attempts", index],
				message: "no attempt may follow acceptance for the same writer",
			});
		}
		stepAttempts.push(attempt);
		attemptsByStep.set(attempt.production_step, stepAttempts);
	}

	for (const productionStep of PRODUCTION_MODEL_STEPS) {
		const stepAttempts = attemptsByStep.get(productionStep) ?? [];
		const completed = projection.completed_steps.includes(productionStep);
		const acceptedAttempt = stepAttempts.findLast((attempt) => attempt.outcome.status === "accepted");
		const finalAttempt = stepAttempts.at(-1);
		const matchingUsage = projection.model_usage.filter(
			(record) => record.production_step === productionStep,
		);

		if (completed) {
			const matchingAcceptedUsage = matchingUsage[0];
			if (acceptedAttempt === undefined || finalAttempt?.outcome.status !== "accepted") {
				context.addIssue({
					code: "custom",
					message: `completed writer ${productionStep} requires a final accepted attempt`,
				});
			}
			if (matchingUsage.length !== 1) {
				context.addIssue({
					code: "custom",
					message: `completed writer ${productionStep} requires exactly one accepted model usage`,
				});
			} else if (
				acceptedAttempt !== undefined &&
				matchingAcceptedUsage !== undefined &&
				!sameModelUsageRecord(acceptedAttempt.model_usage, matchingAcceptedUsage)
			) {
				context.addIssue({
					code: "custom",
					message: `accepted attempt evidence for ${productionStep} must match its accepted model usage`,
				});
			}
		}

		if (
			projection.state === "running" &&
			projection.current_step === productionStep &&
			stepAttempts.length > 0 &&
			!(
				(stepAttempts.length === 1 &&
					stepAttempts[0]?.attempt === 1 &&
					stepAttempts[0]?.outcome.status === "rejected") ||
				(stepAttempts.length === 2 &&
					stepAttempts[0]?.attempt === 1 &&
					stepAttempts[1]?.attempt === 2 &&
					stepAttempts.every((attempt) => attempt.outcome.status === "rejected"))
			)
		) {
			context.addIssue({
				code: "custom",
				message: `running writer ${productionStep} may retain only rejected in-flight attempts`,
			});
		}

		if (projection.state === "errored" && projection.failure?.step === productionStep) {
			if (completed) {
				context.addIssue({
					code: "custom",
					message: `errored writer ${productionStep} cannot also be completed`,
				});
			}
			if (stepAttempts.some((attempt) => attempt.outcome.status === "accepted")) {
				context.addIssue({
					code: "custom",
					message: `errored writer ${productionStep} cannot retain an accepted attempt`,
				});
			}
		}
	}
}

export type { CurrentModelAttemptOutcome, CurrentModelAttemptRecord };
