import { z } from "zod";
import { refineCompletionEvidence } from "./evaluation-artifact-benchmark";
import {
	EvaluationIdSchema,
	EvaluationTimestampSchema,
	StepInvocationSchema,
	evaluationConfigIdentity,
	sha256Json,
} from "./evaluation-artifact-schemas";
import { V4BenchmarkRunBaseSchema } from "./evaluation-artifact-v4";
import { refineVersion5Trial } from "./evaluation-artifact-v5-trial-refinement";
import {
	V1ProductionModelStepSchema,
	V1_PRODUCTION_MODEL_STEPS,
	v1OutputContractProvenance,
} from "./evaluation-artifact-v1-contracts";

export const V5SubjectOutcomeSchema = z.enum([
	"completed",
	"parse_rejected",
	"contract_rejected",
	"infrastructure_incomplete",
]);

const V5CopyeditStepSchema = z.enum(["main_story_copyedit", "announcements_copyedit"]);
export const V5DiagnosticSchema = z.discriminatedUnion("kind", [
	z.strictObject({
		kind: z.literal("preservation"),
		production_step: V5CopyeditStepSchema,
		code: z.enum(["announcement_count", "announcement_identity", "field_shape", "paragraph_count", "quoted_span", "numeric_literal", "protected_markdown", "protected_value"]),
		message: z.string().min(1),
	}),
	z.strictObject({
		kind: z.literal("final_product"),
		production_step: V5CopyeditStepSchema,
		code: z.enum(["forbidden_marker", "ungrounded_marked_name", "ungrounded_quote"]),
		message: z.string().min(1),
	}),
]);

const V5TrackStateSchema = z.strictObject({
	lifecycle: z.enum(["pending", "running", "completed", "rejected"]),
	subject_outcome: V5SubjectOutcomeSchema.nullable(),
	terminal_production_step: V1ProductionModelStepSchema.nullable(),
	product: z.record(z.string(), z.unknown()).nullable(),
	findings: z.array(V5DiagnosticSchema),
});

export const V5EvaluationTrialSchema = z.strictObject({
	id: EvaluationIdSchema,
	config_identity: EvaluationIdSchema,
	repetition: z.number().int().positive(),
	lifecycle: z.enum(["running", "complete"]),
	started_at: EvaluationTimestampSchema,
	completed_at: EvaluationTimestampSchema.nullable(),
	subject_outcome: V5SubjectOutcomeSchema.nullable(),
	tracks: z.strictObject({ main_story: V5TrackStateSchema, announcements: V5TrackStateSchema }),
	selected_invocation_ids: z.strictObject({
		main_story_write: EvaluationIdSchema.nullable(),
		main_story_copyedit: EvaluationIdSchema.nullable(),
		announcements_write: EvaluationIdSchema.nullable(),
		announcements_copyedit: EvaluationIdSchema.nullable(),
	}),
	invocations: z.array(StepInvocationSchema),
});

export const V5SubjectOutcomeCountsSchema = z.strictObject({
	completed: z.number().int().nonnegative(),
	parse_rejected: z.number().int().nonnegative(),
	contract_rejected: z.number().int().nonnegative(),
	infrastructure_incomplete: z.number().int().nonnegative(),
});

export const V5BenchmarkRunBaseSchema = V4BenchmarkRunBaseSchema.omit({
	version: true,
	trials: true,
	outcome_counts: true,
}).extend({
	version: z.literal(5),
	trials: z.array(V5EvaluationTrialSchema),
	outcome_counts: V5SubjectOutcomeCountsSchema,
});

export const V5BenchmarkRunSchema = V5BenchmarkRunBaseSchema.superRefine((run, context) => {
	const identities = new Set<string>();
	for (const [index, declaration] of run.declaration.configurations.entries()) {
		if (declaration.identity !== evaluationConfigIdentity(declaration.config)) context.addIssue({ code: "custom", path: ["declaration", "configurations", index, "identity"], message: "configuration identity must derive from its exact config" });
		if (identities.has(declaration.identity)) context.addIssue({ code: "custom", path: ["declaration", "configurations", index, "identity"], message: "configuration identities must be unique" });
		identities.add(declaration.identity);
		if (Object.values(declaration.config.production_steps).some(({ adapter }) => adapter === "recorded")) context.addIssue({ code: "custom", path: ["declaration", "configurations", index, "config"], message: "artifact version 5 cannot declare a recorded adapter" });
	}

	const expectedRoster = run.declaration.configurations.flatMap((configuration) => Array.from(
		{ length: run.declaration.repetition_count },
		(_, repetitionIndex) => ({ config_identity: configuration.identity, repetition: repetitionIndex + 1 }),
	));
	if (run.trial_roster.length !== expectedRoster.length) context.addIssue({ code: "custom", path: ["trial_roster"], message: "trial roster must be the complete declared configuration and repetition product" });
	const trialIds = new Set<string>();
	for (const [index, member] of run.trial_roster.entries()) {
		const expected = expectedRoster[index];
		if (expected === undefined || member.config_identity !== expected.config_identity || member.repetition !== expected.repetition) context.addIssue({ code: "custom", path: ["trial_roster", index], message: "trial roster must preserve configuration declaration order then repetition order" });
		if (trialIds.has(member.trial_id)) context.addIssue({ code: "custom", path: ["trial_roster", index, "trial_id"], message: "trial roster ids must be unique" });
		trialIds.add(member.trial_id);
	}

	if (run.trials.length > run.trial_roster.length) context.addIssue({ code: "custom", path: ["trials"], message: "retained trials cannot exceed the declared roster" });
	for (const [trialIndex, trial] of run.trials.entries()) {
		const roster = run.trial_roster[trialIndex];
		if (roster === undefined || trial.id !== roster.trial_id || trial.config_identity !== roster.config_identity || trial.repetition !== roster.repetition) context.addIssue({ code: "custom", path: ["trials", trialIndex], message: "trials must be an identity-exact prefix of the declared roster" });
		if (trialIndex < run.trials.length - 1 && trial.lifecycle !== "complete") context.addIssue({ code: "custom", path: ["trials", trialIndex, "lifecycle"], message: "only the final retained trial may be running" });
		if (Date.parse(trial.started_at) < Date.parse(run.started_at)) context.addIssue({ code: "custom", path: ["trials", trialIndex, "started_at"], message: "trial cannot start before its benchmark" });
		const previousTrial = run.trials[trialIndex - 1];
		if (previousTrial?.completed_at !== null && previousTrial?.completed_at !== undefined && Date.parse(trial.started_at) < Date.parse(previousTrial.completed_at)) context.addIssue({ code: "custom", path: ["trials", trialIndex, "started_at"], message: "serial trial cannot start before its predecessor completed" });
		refineVersion5Trial(trial, run.prepared_evidence.snapshot, run.started_at, context, trialIndex);
		for (const productionStep of V1_PRODUCTION_MODEL_STEPS) {
			if (trial.invocations.filter(({ production_step }) => production_step === productionStep).length > run.declaration.transport_retry_limit + 1) context.addIssue({ code: "custom", path: ["trials", trialIndex, "invocations"], message: "production-step invocation count cannot exceed the declared transport retry limit" });
		}
		for (const trackName of ["main_story", "announcements"] as const) {
			const track = trial.tracks[trackName];
			if (track.subject_outcome !== "infrastructure_incomplete" || track.terminal_production_step === null) continue;
			const terminalInvocations = trial.invocations.filter(({ production_step }) => production_step === track.terminal_production_step);
			const lastInvocation = terminalInvocations.at(-1);
			if (lastInvocation?.transport === "failed" && lastInvocation.retry_classification.state === "classified" && lastInvocation.retry_classification.eligible && terminalInvocations.length !== run.declaration.transport_retry_limit + 1) context.addIssue({ code: "custom", path: ["trials", trialIndex, "tracks", trackName], message: "eligible transport exhaustion must consume the declared retry limit" });
		}
		const declaration = run.declaration.configurations.find(({ identity }) => identity === trial.config_identity);
		if (declaration === undefined) continue;
		for (const [invocationIndex, invocation] of trial.invocations.entries()) {
			if (invocation.transport !== "succeeded") continue;
			const adapter = declaration.config.production_steps[invocation.production_step];
			const expectedExecution = adapter.adapter === "lmstudio" ? "local_inference" : adapter.adapter === "recorded" ? "recorded_replay" : "hosted_inference";
			if (invocation.completion.execution !== expectedExecution || (adapter.adapter === "lmstudio" && invocation.completion.provider !== "lmstudio") || (adapter.adapter === "openai_compatible_hosted" && invocation.completion.provider !== adapter.provider)) context.addIssue({ code: "custom", path: ["trials", trialIndex, "invocations", invocationIndex, "completion"], message: "completion must match its declared step adapter execution and provider class" });
			refineCompletionEvidence(adapter, invocation, trialIndex, invocationIndex, context);
		}
	}

	const evidence = run.prepared_evidence;
	if (evidence.identity_sha256 !== sha256Json(evidence.snapshot) || evidence.active_region_id !== evidence.snapshot.active_region_id || evidence.publication_date !== evidence.snapshot.publication_date || evidence.original_count !== evidence.snapshot.raw_count || evidence.final_count !== evidence.snapshot.final_count) context.addIssue({ code: "custom", path: ["prepared_evidence"], message: "prepared-evidence identity and summary must bind the exact retained snapshot" });
	if (JSON.stringify(run.provenance.output_contracts) !== JSON.stringify(v1OutputContractProvenance())) context.addIssue({ code: "custom", path: ["provenance", "output_contracts"], message: "artifact version 5 requires its exact ordered output-contract representations and hashes" });
	const expectedCounts = { completed: 0, parse_rejected: 0, contract_rejected: 0, infrastructure_incomplete: 0 };
	for (const trial of run.trials) if (trial.lifecycle === "complete" && trial.subject_outcome !== null) expectedCounts[trial.subject_outcome] += 1;
	if (JSON.stringify(run.outcome_counts) !== JSON.stringify(expectedCounts)) context.addIssue({ code: "custom", path: ["outcome_counts"], message: "outcome counts must exactly count retained terminal trials" });
	if (run.lifecycle === "running" && (run.completed_at !== null || run.harness_outcome !== "pending")) context.addIssue({ code: "custom", path: ["lifecycle"], message: "running benchmark requires null completion and pending harness outcome" });
	if (run.lifecycle === "complete") {
		if (run.completed_at === null || run.harness_outcome !== "retained" || run.trials.length !== run.trial_roster.length || run.trials.some(({ lifecycle }) => lifecycle !== "complete")) context.addIssue({ code: "custom", path: ["lifecycle"], message: "complete benchmark requires every roster trial terminal and retained harness outcome" });
		if (run.completed_at !== null) {
			const lastTrialCompletion = Math.max(Date.parse(run.started_at), ...run.trials.map(({ completed_at }) => completed_at === null ? Number.POSITIVE_INFINITY : Date.parse(completed_at)));
			if (Date.parse(run.completed_at) < lastTrialCompletion) context.addIssue({ code: "custom", path: ["completed_at"], message: "benchmark completion cannot precede retained trial completion" });
		}
	}
});

export type V5SubjectOutcome = z.infer<typeof V5SubjectOutcomeSchema>;
export type V5EvaluationTrial = z.infer<typeof V5EvaluationTrialSchema>;
export type V5BenchmarkRun = z.infer<typeof V5BenchmarkRunSchema>;
