import { z } from "zod";
import { ModelRuntimeEvidenceSchema, PRODUCTION_MODEL_STEPS, PreparedEvidenceSchema, ProductionModelStepSchema } from "@bc-news/generation-core";
import { HostedModelAdapterConfigSchema, LmStudioAdapterConfigSchema } from "@bc-news/model-adapters";
import {
	EvaluationCodeProvenanceSchema,
	EvaluationIdSchema,
	EvaluationTimestampSchema,
	OutputContractProvenanceSchema,
	Sha256HashSchema,
	StepInvocationSchema,
	canonicallyEqual,
	evaluationConfigIdentity,
	sha256Json,
} from "./evaluation-artifact-schemas";

const RuntimeEvidenceIdentitySchema = z.strictObject({
	trial_id: EvaluationIdSchema,
	invocation_id: EvaluationIdSchema,
	config_identity: EvaluationIdSchema,
	production_step: ProductionModelStepSchema,
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

export const V7ModelAdapterConfigSchema = z.discriminatedUnion("adapter", [
	z.strictObject({ adapter: z.literal("recorded") }),
	LmStudioAdapterConfigSchema,
	HostedModelAdapterConfigSchema,
]);

export const V7EvalConfigSchema = z.strictObject({
	production_steps: z.strictObject({
		main_story_write: V7ModelAdapterConfigSchema,
		main_story_copyedit: V7ModelAdapterConfigSchema,
		announcements_write: V7ModelAdapterConfigSchema,
		announcements_copyedit: V7ModelAdapterConfigSchema,
	}),
});

const CurrentDiagnosticSchema = z.discriminatedUnion("kind", [
	z.strictObject({
		kind: z.literal("preservation"),
		production_step: z.enum(["main_story_copyedit", "announcements_copyedit"]),
		code: z.enum(["announcement_count", "announcement_identity", "field_shape", "paragraph_count", "quoted_span", "numeric_literal", "protected_markdown", "protected_value"]),
		message: z.string().min(1),
	}),
	z.strictObject({
		kind: z.literal("final_product"),
		production_step: z.enum(["main_story_copyedit", "announcements_copyedit"]),
		code: z.enum(["forbidden_marker", "ungrounded_marked_name", "ungrounded_quote"]),
		message: z.string().min(1),
	}),
]);

const CurrentSubjectOutcomeSchema = z.enum(["completed", "parse_rejected", "contract_rejected", "infrastructure_incomplete"]);
const CurrentTrackStateSchema = z.strictObject({
	lifecycle: z.enum(["pending", "running", "completed", "rejected"]),
	subject_outcome: CurrentSubjectOutcomeSchema.nullable(),
	terminal_production_step: ProductionModelStepSchema.nullable(),
	product: z.record(z.string(), z.unknown()).nullable(),
	findings: z.array(CurrentDiagnosticSchema),
});
const CurrentEvaluationTrialSchema = z.strictObject({
	id: EvaluationIdSchema,
	config_identity: EvaluationIdSchema,
	repetition: z.number().int().positive(),
	lifecycle: z.enum(["running", "complete"]),
	started_at: EvaluationTimestampSchema,
	completed_at: EvaluationTimestampSchema.nullable(),
	subject_outcome: CurrentSubjectOutcomeSchema.nullable(),
	tracks: z.strictObject({ main_story: CurrentTrackStateSchema, announcements: CurrentTrackStateSchema }),
	selected_invocation_ids: z.strictObject({
		main_story_write: EvaluationIdSchema.nullable(),
		main_story_copyedit: EvaluationIdSchema.nullable(),
		announcements_write: EvaluationIdSchema.nullable(),
		announcements_copyedit: EvaluationIdSchema.nullable(),
	}),
	invocations: z.array(StepInvocationSchema),
});
const CurrentOutcomeCountsSchema = z.strictObject({
	completed: z.number().int().nonnegative(),
	parse_rejected: z.number().int().nonnegative(),
	contract_rejected: z.number().int().nonnegative(),
	infrastructure_incomplete: z.number().int().nonnegative(),
});
const DeclaredConfigurationSchema = z.strictObject({ identity: EvaluationIdSchema, config: V7EvalConfigSchema });
const TrialRosterMemberSchema = z.strictObject({
	trial_id: EvaluationIdSchema,
	config_identity: EvaluationIdSchema,
	repetition: z.number().int().positive(),
});

export const V7BenchmarkRunBaseSchema = z.strictObject({
	version: z.literal(7),
	id: EvaluationIdSchema,
	lifecycle: z.enum(["running", "complete"]),
	started_at: EvaluationTimestampSchema,
	completed_at: EvaluationTimestampSchema.nullable(),
	declaration: z.strictObject({
		configurations: z.array(DeclaredConfigurationSchema).min(1),
		repetition_count: z.number().int().positive(),
		transport_retry_limit: z.number().int().min(0).max(3),
	}),
	fixture: z.strictObject({ path: z.string().min(1), fixture_sha256: Sha256HashSchema }),
	prepared_evidence: z.strictObject({
		identity_sha256: Sha256HashSchema,
		active_region_id: z.string().min(1),
		publication_date: z.iso.date(),
		original_count: z.number().int().nonnegative(),
		final_count: z.number().int().nonnegative(),
		snapshot: PreparedEvidenceSchema,
	}),
	provenance: z.strictObject({
		code: EvaluationCodeProvenanceSchema,
		output_contracts: z.tuple([OutputContractProvenanceSchema, OutputContractProvenanceSchema, OutputContractProvenanceSchema, OutputContractProvenanceSchema]),
	}),
	trial_roster: z.array(TrialRosterMemberSchema).min(1),
	trials: z.array(CurrentEvaluationTrialSchema),
	runtime_evidence: z.array(RuntimeEvidenceRecordSchema),
	outcome_counts: CurrentOutcomeCountsSchema,
	harness_outcome: z.enum(["pending", "retained"]),
});

export type CurrentBenchmarkRunCandidate = z.infer<typeof V7BenchmarkRunBaseSchema>;
type CurrentTrial = CurrentBenchmarkRunCandidate["trials"][number];
type CurrentInvocation = CurrentTrial["invocations"][number];

function currentTrackOutcome(trial: CurrentTrial, trackName: "main_story" | "announcements") {
	const track = trial.tracks[trackName];
	if (track.lifecycle === "completed") return "completed" as const;
	const terminalStep = track.terminal_production_step;
	if (terminalStep === null) return "infrastructure_incomplete" as const;
	const terminal = trial.invocations.filter(({ production_step }) => production_step === terminalStep).at(-1);
	if (terminal?.parse.state === "rejected") {
		if (terminal.parse.findings.some(({ kind }) => kind === "invalid_json")) return "parse_rejected" as const;
		if (terminal.parse.findings.some(({ kind }) => kind === "contract_mismatch")) return "contract_rejected" as const;
	}
	return terminal?.transport === "failed" ? "infrastructure_incomplete" as const : "completed" as const;
}

export function deriveCurrentTrialOutcome(trial: CurrentTrial) {
	const outcomes = new Set([currentTrackOutcome(trial, "main_story"), currentTrackOutcome(trial, "announcements")]);
	return (["infrastructure_incomplete", "parse_rejected", "contract_rejected", "completed"] as const)
		.find((outcome) => outcomes.has(outcome)) ?? "completed";
}

function refineCurrentInvocationRoster(trial: CurrentTrial, benchmarkStartedAt: string, context: z.RefinementCtx): void {
	const ids = new Set<string>();
	const previousByStep = new Map<CurrentInvocation["production_step"], CurrentInvocation>();
	let previousStartedAt = Number.NEGATIVE_INFINITY;
	const lowerBound = Math.max(Date.parse(benchmarkStartedAt), Date.parse(trial.started_at));
	for (const [index, invocation] of trial.invocations.entries()) {
		const startedAt = Date.parse(invocation.started_at);
		if (startedAt < lowerBound) context.addIssue({ code: "custom", path: ["invocations", index, "started_at"], message: "invocation cannot start before its benchmark or trial" });
		if (startedAt < previousStartedAt) context.addIssue({ code: "custom", path: ["invocations", index, "started_at"], message: "invocation starts must be nondecreasing in ordinal order" });
		previousStartedAt = startedAt;
		if (invocation.transport !== "in_flight" && Date.parse(invocation.ended_at) < lowerBound) context.addIssue({ code: "custom", path: ["invocations", index, "ended_at"], message: "invocation cannot end before its benchmark or trial" });
		if (ids.has(invocation.id)) context.addIssue({ code: "custom", path: ["invocations", index, "id"], message: "invocation ids must be unique" });
		ids.add(invocation.id);
		if (invocation.ordinal !== index + 1) context.addIssue({ code: "custom", path: ["invocations", index, "ordinal"], message: "invocation ordinals must be contiguous" });
		if (invocation.config_identity !== trial.config_identity) context.addIssue({ code: "custom", path: ["invocations", index, "config_identity"], message: "invocation config identity must equal its trial" });
		const predecessor = previousByStep.get(invocation.production_step);
		if (predecessor === undefined) {
			if (invocation.predecessor_invocation_id !== null) context.addIssue({ code: "custom", path: ["invocations", index, "predecessor_invocation_id"], message: "first invocation for a production step must have no predecessor" });
		} else {
			if (invocation.predecessor_invocation_id !== predecessor.id) context.addIssue({ code: "custom", path: ["invocations", index, "predecessor_invocation_id"], message: "later invocation must point to the immediately previous invocation for the same step" });
			if (predecessor.transport !== "failed" || predecessor.retry_classification.state !== "classified" || !predecessor.retry_classification.eligible) context.addIssue({ code: "custom", path: ["invocations", index, "predecessor_invocation_id"], message: "retry predecessor must be a classified eligible transport failure" });
			if (!canonicallyEqual(invocation.request, predecessor.request) || invocation.request_sha256 !== predecessor.request_sha256) context.addIssue({ code: "custom", path: ["invocations", index, "request"], message: "retry request and request hash must equal its predecessor exactly" });
		}
		previousByStep.set(invocation.production_step, invocation);
		if (invocation.parse.state === "rejected" && invocation.parse.findings.some(({ production_step }) => production_step !== invocation.production_step)) context.addIssue({ code: "custom", path: ["invocations", index, "parse", "findings"], message: "parse findings must belong to their invocation step" });
		if (invocation.parse.state === "rejected" && invocation.parse.findings.some(({ kind }) => kind !== "invalid_json" && kind !== "contract_mismatch")) context.addIssue({ code: "custom", path: ["invocations", index, "parse", "findings"], message: "parse rejection permits only malformed JSON or strict schema mismatch" });
	}
}

function refineCurrentTrial(trial: CurrentTrial, benchmarkStartedAt: string, context: z.RefinementCtx, trialIndex: number, allowNullCompletion: boolean): void {
	const path = ["trials", trialIndex] as const;
	const issue = (relativePath: PropertyKey[], message: string) => context.addIssue({ code: "custom", path: [...path, ...relativePath], message });
	if (!allowNullCompletion) for (const [index, invocation] of trial.invocations.entries()) {
		if (invocation.transport === "succeeded" && invocation.completion.text === null) issue(["invocations", index, "completion", "text"], "current non-Gateway runs require textual completion content");
	}
	const trialContext: z.RefinementCtx = { value: context.value, issues: context.issues, addIssue(candidate) {
		if (typeof candidate === "string") issue([], candidate);
		else context.addIssue({ ...candidate, path: [...path, ...(candidate.path ?? [])] });
	} };
	refineCurrentInvocationRoster(trial, benchmarkStartedAt, trialContext);
	for (const step of PRODUCTION_MODEL_STEPS) {
		const selectedId = trial.selected_invocation_ids[step];
		if (selectedId === null) continue;
		const selected = trial.invocations.find(({ id }) => id === selectedId);
		if (selected === undefined || selected.production_step !== step || selected.config_identity !== trial.config_identity || selected.transport !== "succeeded" || selected.parse.state !== "succeeded") issue(["selected_invocation_ids", step], "selected invocation must resolve to parsed success for the same step and config");
	}
	for (const trackName of ["main_story", "announcements"] as const) {
		const track = trial.tracks[trackName];
		const writerStep = `${trackName}_write` as const;
		const copyeditStep = `${trackName}_copyedit` as const;
		const selectedWriter = trial.selected_invocation_ids[writerStep];
		const selectedCopyedit = trial.selected_invocation_ids[copyeditStep];
		const terminal = track.lifecycle === "completed" || track.lifecycle === "rejected";
		if (selectedCopyedit !== null && selectedWriter === null) issue(["selected_invocation_ids", copyeditStep], "selected copyedit requires a selected writer");
		if (selectedWriter !== null && selectedCopyedit !== null && trial.invocations.findIndex(({ id }) => id === selectedWriter) >= trial.invocations.findIndex(({ id }) => id === selectedCopyedit)) issue(["selected_invocation_ids", copyeditStep], "selected writer must execute before its selected copyedit");
		if (!terminal && (track.subject_outcome !== null || track.terminal_production_step !== null || track.product !== null || track.findings.length > 0)) issue(["tracks", trackName], "nonterminal track cannot retain terminal data");
		if (terminal && (track.subject_outcome === null || track.terminal_production_step === null || !track.terminal_production_step.startsWith(trackName))) issue(["tracks", trackName], "terminal track must name its own outcome and production step");
		if (track.findings.some(({ production_step }) => production_step !== copyeditStep)) issue(["tracks", trackName, "findings"], "diagnostics must belong to the track copyedit step");
		if (track.lifecycle === "completed" && (track.subject_outcome !== "completed" || track.terminal_production_step !== copyeditStep || track.product === null || selectedWriter === null || selectedCopyedit === null)) issue(["tracks", trackName], "completed track requires selected writer and copyedit, completed outcome, and retained product");
		if (track.lifecycle === "rejected") {
			if (track.subject_outcome === "completed" || track.subject_outcome !== currentTrackOutcome(trial, trackName)) issue(["tracks", trackName, "subject_outcome"], "rejected track outcome must match retained terminal evidence");
			if (track.product !== null || track.findings.length !== 0) issue(["tracks", trackName], "rejected track cannot retain a product or completed-track diagnostics");
			if (track.terminal_production_step === copyeditStep && selectedWriter === null) issue(["selected_invocation_ids", writerStep], "copyedit-terminal rejection requires a selected writer");
			if (track.terminal_production_step === writerStep && trial.invocations.some(({ production_step }) => production_step === copyeditStep)) issue(["invocations"], "writer-terminal rejection forbids copyedit invocation");
		}
	}
	if (trial.lifecycle === "running" && (trial.completed_at !== null || trial.subject_outcome !== null)) issue(["lifecycle"], "running trial cannot be terminal");
	if (trial.lifecycle !== "complete") return;
	if (trial.completed_at === null || trial.subject_outcome === null || Object.values(trial.tracks).some(({ lifecycle }) => lifecycle !== "completed" && lifecycle !== "rejected")) issue(["lifecycle"], "complete trial requires terminal tracks, time, and outcome");
	if (trial.invocations.some((invocation) => invocation.transport === "in_flight" || (invocation.transport === "failed" && invocation.retry_classification.state === "pending") || (invocation.transport === "succeeded" && invocation.parse.state === "pending"))) issue(["invocations"], "complete trial cannot retain pending invocation work");
	if (trial.subject_outcome !== deriveCurrentTrialOutcome(trial)) issue(["subject_outcome"], "trial outcome must match its terminal tracks");
	if (trial.completed_at !== null) {
		const latestReached = Math.max(Date.parse(trial.started_at), ...trial.invocations.flatMap((invocation) => invocation.transport === "in_flight" ? [Date.parse(invocation.started_at)] : [Date.parse(invocation.started_at), Date.parse(invocation.ended_at)]));
		if (Date.parse(trial.completed_at) < latestReached) issue(["completed_at"], "trial completion cannot precede reached invocation timing or trial start");
	}
}

export function refineCurrentBenchmarkRun(run: CurrentBenchmarkRunCandidate, context: z.RefinementCtx, allowNullCompletion = false): void {
	const identities = new Set<string>();
	for (const [index, declaration] of run.declaration.configurations.entries()) {
		if (declaration.identity !== evaluationConfigIdentity(declaration.config)) context.addIssue({ code: "custom", path: ["declaration", "configurations", index, "identity"], message: "configuration identity must derive from its exact config" });
		if (identities.has(declaration.identity)) context.addIssue({ code: "custom", path: ["declaration", "configurations", index, "identity"], message: "configuration identities must be unique" });
		identities.add(declaration.identity);
		if (Object.values(declaration.config.production_steps).some(({ adapter }) => adapter === "recorded")) context.addIssue({ code: "custom", path: ["declaration", "configurations", index, "config"], message: "current live artifacts cannot declare a recorded adapter" });
	}
	const expectedRoster = run.declaration.configurations.flatMap((configuration) => Array.from({ length: run.declaration.repetition_count }, (_, repetitionIndex) => ({ config_identity: configuration.identity, repetition: repetitionIndex + 1 })));
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
		refineCurrentTrial(trial, run.started_at, context, trialIndex, allowNullCompletion);
		for (const productionStep of PRODUCTION_MODEL_STEPS) if (trial.invocations.filter(({ production_step }) => production_step === productionStep).length > run.declaration.transport_retry_limit + 1) context.addIssue({ code: "custom", path: ["trials", trialIndex, "invocations"], message: "production-step invocation count cannot exceed the declared transport retry limit" });
		const declaration = run.declaration.configurations.find(({ identity }) => identity === trial.config_identity);
		if (declaration === undefined) continue;
		for (const [invocationIndex, invocation] of trial.invocations.entries()) {
			if (invocation.transport !== "succeeded") continue;
			const adapter = declaration.config.production_steps[invocation.production_step];
			const expectedExecution = adapter.adapter === "lmstudio" ? "local_inference" : adapter.adapter === "recorded" ? "recorded_replay" : "hosted_inference";
			if (invocation.completion.execution !== expectedExecution || (adapter.adapter === "lmstudio" && invocation.completion.provider !== "lmstudio") || (adapter.adapter === "openai_compatible_hosted" && invocation.completion.provider !== adapter.provider)) context.addIssue({ code: "custom", path: ["trials", trialIndex, "invocations", invocationIndex, "completion"], message: "completion must match its declared step adapter execution and provider class" });
			if (adapter.adapter === "lmstudio") {
				const billing = invocation.completion.external_billing;
				if (billing.classification !== "none" || billing.reason !== "local_inference") context.addIssue({ code: "custom", path: ["trials", trialIndex, "invocations", invocationIndex, "completion"], message: "local inference must retain zero external billing" });
			}
			if (adapter.adapter === "openai_compatible_hosted") {
				const usage = invocation.completion.token_usage;
				const billing = invocation.completion.external_billing;
				if (usage.measurement !== "reported") context.addIssue({ code: "custom", path: ["trials", trialIndex, "invocations", invocationIndex, "completion"], message: "hosted inference must retain provider-reported token usage" });
				else {
					const expectedAmount = (usage.input_tokens * adapter.billing.input_usd_per_million_tokens + usage.output_tokens * adapter.billing.output_usd_per_million_tokens) / 1_000_000;
					if (billing.classification !== "calculated" || billing.amount_usd !== expectedAmount || billing.pricing_reference !== adapter.billing.pricing_reference) context.addIssue({ code: "custom", path: ["trials", trialIndex, "invocations", invocationIndex, "completion"], message: "hosted inference billing must derive from retained usage and declared pricing" });
				}
			}
		}
	}
	const evidence = run.prepared_evidence;
	if (evidence.identity_sha256 !== sha256Json(evidence.snapshot) || evidence.active_region_id !== evidence.snapshot.active_region_id || evidence.publication_date !== evidence.snapshot.publication_date || evidence.original_count !== evidence.snapshot.raw_count || evidence.final_count !== evidence.snapshot.final_count) context.addIssue({ code: "custom", path: ["prepared_evidence"], message: "prepared-evidence identity and summary must bind the retained snapshot" });
	const expectedCounts = { completed: 0, parse_rejected: 0, contract_rejected: 0, infrastructure_incomplete: 0 };
	for (const trial of run.trials) if (trial.lifecycle === "complete" && trial.subject_outcome !== null) expectedCounts[trial.subject_outcome] += 1;
	if (!canonicallyEqual(run.outcome_counts, expectedCounts)) context.addIssue({ code: "custom", path: ["outcome_counts"], message: "outcome counts must exactly count retained terminal trials" });
	if (run.lifecycle === "running" && (run.completed_at !== null || run.harness_outcome !== "pending")) context.addIssue({ code: "custom", path: ["lifecycle"], message: "running benchmark requires null completion and pending harness outcome" });
	if (run.lifecycle === "complete") {
		if (run.completed_at === null || run.harness_outcome !== "retained" || run.trials.length !== run.trial_roster.length || run.trials.some(({ lifecycle }) => lifecycle !== "complete")) context.addIssue({ code: "custom", path: ["lifecycle"], message: "complete benchmark requires every roster trial terminal and retained harness outcome" });
		if (run.completed_at !== null) {
			const lastTrialCompletion = Math.max(Date.parse(run.started_at), ...run.trials.map(({ completed_at }) => completed_at === null ? Number.POSITIVE_INFINITY : Date.parse(completed_at)));
			if (Date.parse(run.completed_at) < lastTrialCompletion) context.addIssue({ code: "custom", path: ["completed_at"], message: "benchmark completion cannot precede retained trial completion" });
		}
	}
}

export const V7BenchmarkRunSchema = V7BenchmarkRunBaseSchema.superRefine((run, context) => {
	refineCurrentBenchmarkRun(run, context);
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
