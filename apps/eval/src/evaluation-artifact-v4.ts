import { z } from "zod";
import { refineCompletionEvidence } from "./evaluation-artifact-benchmark";
import {
	EvaluationIdSchema,
	evaluationConfigIdentity,
	sha256Json,
} from "./evaluation-artifact-schemas";
import { V3BenchmarkRunBaseSchema } from "./evaluation-artifact-v3";
import { refineVersion3Trial } from "./evaluation-artifact-v3-trial-refinement";
import {
	V1_PRODUCTION_MODEL_STEPS,
	v1OutputContractProvenance,
} from "./evaluation-artifact-v1-contracts";

const NonBlankStringSchema = z.string().trim().min(1);
const SamplingSchema = z.strictObject({
	temperature: z.number().finite().min(0).max(2),
	top_p: z.number().finite().min(0).max(1),
	top_k: z.number().int().nonnegative(),
});

const RecordedAdapterConfigSchema = z.strictObject({ adapter: z.literal("recorded") });
const LmStudioAdapterConfigSchema = z.strictObject({
	adapter: z.literal("lmstudio"),
	model: NonBlankStringSchema,
	sampling: SamplingSchema.optional(),
	reasoning_effort: z.literal("provider_default"),
});
const HostedAdapterConfigSchema = z.strictObject({
	adapter: z.literal("openai_compatible_hosted"),
	provider: NonBlankStringSchema,
	model: NonBlankStringSchema,
	billing: z.strictObject({
		method: z.literal("calculated"),
		input_usd_per_million_tokens: z.number().finite().nonnegative(),
		output_usd_per_million_tokens: z.number().finite().nonnegative(),
		pricing_reference: NonBlankStringSchema,
	}),
});

export const V4ModelAdapterConfigSchema = z.discriminatedUnion("adapter", [
	RecordedAdapterConfigSchema,
	LmStudioAdapterConfigSchema,
	HostedAdapterConfigSchema,
]);

const V4ProductionStepsConfigSchema = z.strictObject({
	main_story_write: V4ModelAdapterConfigSchema,
	main_story_copyedit: V4ModelAdapterConfigSchema,
	announcements_write: V4ModelAdapterConfigSchema,
	announcements_copyedit: V4ModelAdapterConfigSchema,
}).superRefine((steps, context) => {
	const localSteps = Object.values(steps).filter((config) => config.adapter === "lmstudio");
	if (localSteps.length === 0) return;
	const explicitCount = localSteps.filter((config) => config.adapter === "lmstudio" && config.sampling !== undefined).length;
	if (explicitCount !== 0 && explicitCount !== localSteps.length) {
		context.addIssue({
			code: "custom",
			message: "all LM Studio production steps must consistently omit sampling or provide a complete explicit tuple",
		});
	}
});

export const V4EvalConfigSchema = z.strictObject({
	production_steps: V4ProductionStepsConfigSchema,
});

const DeclaredConfigurationSchema = z.strictObject({
	identity: EvaluationIdSchema,
	config: V4EvalConfigSchema,
});

export const V4BenchmarkRunBaseSchema = V3BenchmarkRunBaseSchema.omit({
	version: true,
	declaration: true,
}).extend({
	version: z.literal(4),
	declaration: z.strictObject({
		configurations: z.array(DeclaredConfigurationSchema).min(1),
		repetition_count: z.number().int().positive(),
		transport_retry_limit: z.number().int().min(0).max(3),
	}),
});

export const V4BenchmarkRunSchema = V4BenchmarkRunBaseSchema.superRefine((run, context) => {
	const identities = new Set<string>();
	for (const [index, declaration] of run.declaration.configurations.entries()) {
		if (declaration.identity !== evaluationConfigIdentity(declaration.config)) {
			context.addIssue({ code: "custom", path: ["declaration", "configurations", index, "identity"], message: "configuration identity must derive from its exact config" });
		}
		if (identities.has(declaration.identity)) {
			context.addIssue({ code: "custom", path: ["declaration", "configurations", index, "identity"], message: "configuration identities must be unique" });
		}
		identities.add(declaration.identity);
		if (Object.values(declaration.config.production_steps).some(({ adapter }) => adapter === "recorded")) {
			context.addIssue({ code: "custom", path: ["declaration", "configurations", index, "config"], message: "artifact version 4 cannot declare a recorded adapter" });
		}
	}

	const expectedRoster = run.declaration.configurations.flatMap((configuration) =>
		Array.from({ length: run.declaration.repetition_count }, (_, repetitionIndex) => ({
			config_identity: configuration.identity,
			repetition: repetitionIndex + 1,
		})),
	);
	if (run.trial_roster.length !== expectedRoster.length) {
		context.addIssue({ code: "custom", path: ["trial_roster"], message: "trial roster must be the complete declared configuration and repetition product" });
	}
	const trialIds = new Set<string>();
	for (const [index, member] of run.trial_roster.entries()) {
		const expected = expectedRoster[index];
		if (expected === undefined || member.config_identity !== expected.config_identity || member.repetition !== expected.repetition) {
			context.addIssue({ code: "custom", path: ["trial_roster", index], message: "trial roster must preserve configuration declaration order then repetition order" });
		}
		if (trialIds.has(member.trial_id)) context.addIssue({ code: "custom", path: ["trial_roster", index, "trial_id"], message: "trial roster ids must be unique" });
		trialIds.add(member.trial_id);
	}

	if (run.trials.length > run.trial_roster.length) context.addIssue({ code: "custom", path: ["trials"], message: "retained trials cannot exceed the declared roster" });
	for (const [trialIndex, trial] of run.trials.entries()) {
		const roster = run.trial_roster[trialIndex];
		if (roster === undefined || trial.id !== roster.trial_id || trial.config_identity !== roster.config_identity || trial.repetition !== roster.repetition) {
			context.addIssue({ code: "custom", path: ["trials", trialIndex], message: "trials must be an identity-exact prefix of the declared roster" });
		}
		if (trialIndex < run.trials.length - 1 && trial.lifecycle !== "complete") {
			context.addIssue({ code: "custom", path: ["trials", trialIndex, "lifecycle"], message: "only the final retained trial may be running" });
		}
		if (Date.parse(trial.started_at) < Date.parse(run.started_at)) {
			context.addIssue({ code: "custom", path: ["trials", trialIndex, "started_at"], message: "trial cannot start before its benchmark" });
		}
		const previousTrial = run.trials[trialIndex - 1];
		if (previousTrial?.completed_at !== null && previousTrial?.completed_at !== undefined
			&& Date.parse(trial.started_at) < Date.parse(previousTrial.completed_at)) {
			context.addIssue({ code: "custom", path: ["trials", trialIndex, "started_at"], message: "serial trial cannot start before its predecessor completed" });
		}
		refineVersion3Trial(trial, run.prepared_evidence.snapshot, run.started_at, context, trialIndex);
		for (const productionStep of V1_PRODUCTION_MODEL_STEPS) {
			if (trial.invocations.filter(({ production_step }) => production_step === productionStep).length > run.declaration.transport_retry_limit + 1) {
				context.addIssue({ code: "custom", path: ["trials", trialIndex, "invocations"], message: "production-step invocation count cannot exceed the declared transport retry limit" });
			}
		}
		for (const trackName of ["main_story", "announcements"] as const) {
			const track = trial.tracks[trackName];
			if (track.subject_outcome !== "infrastructure_incomplete" || track.terminal_production_step === null) continue;
			const terminalInvocations = trial.invocations.filter(({ production_step }) => production_step === track.terminal_production_step);
			const lastInvocation = terminalInvocations.at(-1);
			if (lastInvocation?.transport === "failed"
				&& lastInvocation.retry_classification.state === "classified"
				&& lastInvocation.retry_classification.eligible
				&& terminalInvocations.length !== run.declaration.transport_retry_limit + 1) {
				context.addIssue({ code: "custom", path: ["trials", trialIndex, "tracks", trackName], message: "eligible transport exhaustion must consume the declared retry limit" });
			}
		}
		const declaration = run.declaration.configurations.find(({ identity }) => identity === trial.config_identity);
		if (declaration === undefined) continue;
		for (const [invocationIndex, invocation] of trial.invocations.entries()) {
			if (invocation.transport !== "succeeded") continue;
			const adapter = declaration.config.production_steps[invocation.production_step];
			const expectedExecution = adapter.adapter === "lmstudio" ? "local_inference" : adapter.adapter === "recorded" ? "recorded_replay" : "hosted_inference";
			if (invocation.completion.execution !== expectedExecution
				|| (adapter.adapter === "lmstudio" && invocation.completion.provider !== "lmstudio")
				|| (adapter.adapter === "openai_compatible_hosted" && invocation.completion.provider !== adapter.provider)) {
				context.addIssue({ code: "custom", path: ["trials", trialIndex, "invocations", invocationIndex, "completion"], message: "completion must match its declared step adapter execution and provider class" });
			}
			refineCompletionEvidence(adapter, invocation, trialIndex, invocationIndex, context);
		}
	}

	const evidence = run.prepared_evidence;
	if (evidence.identity_sha256 !== sha256Json(evidence.snapshot)
		|| evidence.active_region_id !== evidence.snapshot.active_region_id
		|| evidence.publication_date !== evidence.snapshot.publication_date
		|| evidence.original_count !== evidence.snapshot.raw_count
		|| evidence.final_count !== evidence.snapshot.final_count) {
		context.addIssue({ code: "custom", path: ["prepared_evidence"], message: "prepared-evidence identity and summary must bind the exact retained snapshot" });
	}
	if (JSON.stringify(run.provenance.output_contracts) !== JSON.stringify(v1OutputContractProvenance())) {
		context.addIssue({ code: "custom", path: ["provenance", "output_contracts"], message: "artifact version 4 requires its exact ordered output-contract representations and hashes" });
	}

	const expectedCounts = Object.fromEntries(Object.keys(run.outcome_counts).map((key) => [key, 0])) as Record<keyof typeof run.outcome_counts, number>;
	for (const trial of run.trials) if (trial.lifecycle === "complete" && trial.subject_outcome !== null) expectedCounts[trial.subject_outcome] += 1;
	if (JSON.stringify(run.outcome_counts) !== JSON.stringify(expectedCounts)) context.addIssue({ code: "custom", path: ["outcome_counts"], message: "outcome counts must exactly count retained terminal trials" });
	if (run.lifecycle === "running") {
		if (run.completed_at !== null || run.harness_outcome !== "pending") context.addIssue({ code: "custom", path: ["lifecycle"], message: "running benchmark requires null completion and pending harness outcome" });
	}
	if (run.lifecycle === "complete") {
		if (run.completed_at === null || run.harness_outcome !== "retained" || run.trials.length !== run.trial_roster.length || run.trials.some(({ lifecycle }) => lifecycle !== "complete")) {
			context.addIssue({ code: "custom", path: ["lifecycle"], message: "complete benchmark requires every roster trial terminal and retained harness outcome" });
		}
		if (run.completed_at !== null) {
			const lastTrialCompletion = Math.max(Date.parse(run.started_at), ...run.trials.map(({ completed_at }) => completed_at === null ? Number.POSITIVE_INFINITY : Date.parse(completed_at)));
			if (Date.parse(run.completed_at) < lastTrialCompletion) context.addIssue({ code: "custom", path: ["completed_at"], message: "benchmark completion cannot precede retained trial completion" });
		}
	}
});

export type V4EvalConfig = z.infer<typeof V4EvalConfigSchema>;
export type V4BenchmarkRun = z.infer<typeof V4BenchmarkRunSchema>;
