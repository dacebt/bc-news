import { z } from "zod";
import { refineCompletionEvidence } from "./evaluation-artifact-benchmark";
import { refineVersion3Trial } from "./evaluation-artifact-v3-trial-refinement";
import {
	EvaluationCodeProvenanceSchema,
	EvaluationIdSchema,
	EvaluationTimestampSchema,
	EvaluationTrialV2Schema,
	OutputContractProvenanceSchema,
	SubjectOutcomeCountsSchema,
	evaluationConfigIdentity,
	sha256Json,
} from "./evaluation-artifact-schemas";
import {
	V1EvalConfigSchema,
	V1_PRODUCTION_MODEL_STEPS,
	V1PreparedEvidenceSchema,
	V1Sha256HashSchema,
	v1OutputContractProvenance,
} from "./evaluation-artifact-v1-contracts";

const DeclaredConfigurationSchema = z.strictObject({
	identity: EvaluationIdSchema,
	config: V1EvalConfigSchema,
});

const TrialRosterMemberSchema = z.strictObject({
	trial_id: EvaluationIdSchema,
	config_identity: EvaluationIdSchema,
	repetition: z.number().int().positive(),
});

export const V3BenchmarkRunBaseSchema = z.strictObject({
	version: z.literal(3),
	id: EvaluationIdSchema,
	lifecycle: z.enum(["running", "complete"]),
	started_at: EvaluationTimestampSchema,
	completed_at: EvaluationTimestampSchema.nullable(),
	declaration: z.strictObject({
		configurations: z.array(DeclaredConfigurationSchema).min(1),
		repetition_count: z.number().int().positive(),
		transport_retry_limit: z.number().int().min(0).max(3),
	}),
	fixture: z.strictObject({ path: z.string().min(1), fixture_sha256: V1Sha256HashSchema }),
	prepared_evidence: z.strictObject({
		identity_sha256: V1Sha256HashSchema,
		active_region_id: z.string().min(1),
		publication_date: z.iso.date(),
		original_count: z.number().int().nonnegative(),
		final_count: z.number().int().nonnegative(),
		snapshot: V1PreparedEvidenceSchema,
	}),
	provenance: z.strictObject({
		code: EvaluationCodeProvenanceSchema,
		output_contracts: z.tuple([
			OutputContractProvenanceSchema,
			OutputContractProvenanceSchema,
			OutputContractProvenanceSchema,
			OutputContractProvenanceSchema,
		]),
	}),
	trial_roster: z.array(TrialRosterMemberSchema).min(1),
	trials: z.array(EvaluationTrialV2Schema),
	outcome_counts: SubjectOutcomeCountsSchema,
	harness_outcome: z.enum(["pending", "retained"]),
});

export const V3BenchmarkRunSchema = V3BenchmarkRunBaseSchema.superRefine((run, context) => {
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
			context.addIssue({ code: "custom", path: ["declaration", "configurations", index, "config"], message: "artifact version 3 cannot declare a recorded adapter" });
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
		context.addIssue({ code: "custom", path: ["provenance", "output_contracts"], message: "artifact version 3 requires its exact ordered output-contract representations and hashes" });
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

export type V3BenchmarkRun = z.infer<typeof V3BenchmarkRunSchema>;

