import type { z } from "zod";
import { canonicallyEqual } from "./evaluation-artifact-schemas";
import { stepTrack } from "./evaluation-artifact-outcomes";
import {
	V1AnnouncementsWriterOutputSchema,
	V1MainStoryProductSchema,
	V1_PRODUCTION_MODEL_STEPS,
	type V1PreparedEvidence,
	type V1ProductionModelStep,
	type V1WriterOutput,
} from "./evaluation-artifact-v1-contracts";
import { expectedVersion5Diagnostics, refineVersion5ParserPromptAndProductRelations } from "./evaluation-artifact-v5-relations";
import type { V5EvaluationTrial, V5SubjectOutcome } from "./evaluation-artifact-v5";

type V5Invocation = V5EvaluationTrial["invocations"][number];

function refineInvocationRoster(trial: V5EvaluationTrial, benchmarkStartedAt: string, context: z.RefinementCtx): void {
	const ids = new Set<string>();
	const previousByStep = new Map<V1ProductionModelStep, V5Invocation>();
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
		if (invocation.parse.state === "rejected" && invocation.parse.findings.some(({ kind }) => kind !== "invalid_json" && kind !== "contract_mismatch")) context.addIssue({ code: "custom", path: ["invocations", index, "parse", "findings"], message: "artifact version 5 parse rejection permits only malformed JSON or strict schema mismatch" });
	}
}

function refineSelections(trial: V5EvaluationTrial, context: z.RefinementCtx): void {
	for (const step of V1_PRODUCTION_MODEL_STEPS) {
		const selectedId = trial.selected_invocation_ids[step];
		if (selectedId === null) continue;
		const selected = trial.invocations.find(({ id }) => id === selectedId);
		if (selected === undefined || selected.production_step !== step || selected.config_identity !== trial.config_identity || selected.transport !== "succeeded" || selected.parse.state !== "succeeded") context.addIssue({ code: "custom", path: ["selected_invocation_ids", step], message: "selected invocation must resolve to parsed success for the same step and config" });
	}
}

function trackOutcome(trial: V5EvaluationTrial, trackName: "main_story" | "announcements"): V5SubjectOutcome {
	const track = trial.tracks[trackName];
	if (track.lifecycle === "completed") return "completed";
	const terminalStep = track.terminal_production_step;
	if (terminalStep === null) return "infrastructure_incomplete";
	const invocations = trial.invocations.filter(({ production_step }) => production_step === terminalStep);
	const terminal = invocations.at(-1);
	if (terminal?.parse.state === "rejected") {
		if (terminal.parse.findings.some(({ kind }) => kind === "invalid_json")) return "parse_rejected";
		if (terminal.parse.findings.some(({ kind }) => kind === "contract_mismatch")) return "contract_rejected";
	}
	return terminal?.transport === "failed" ? "infrastructure_incomplete" : "completed";
}

export function deriveVersion5TrialOutcome(trial: V5EvaluationTrial): V5SubjectOutcome {
	const outcomes = new Set([trackOutcome(trial, "main_story"), trackOutcome(trial, "announcements")]);
	return (["infrastructure_incomplete", "parse_rejected", "contract_rejected", "completed"] as const).find((outcome) => outcomes.has(outcome)) ?? "completed";
}

function selectedWriterOutput(trial: V5EvaluationTrial, trackName: "main_story" | "announcements"): V1WriterOutput | undefined {
	const writerStep = trackName === "main_story" ? "main_story_write" : "announcements_write";
	const id = trial.selected_invocation_ids[writerStep];
	const invocation = id === null ? undefined : trial.invocations.find((candidate) => candidate.id === id);
	if (invocation?.transport !== "succeeded" || invocation.parse.state !== "succeeded") return undefined;
	return trackName === "main_story"
		? V1MainStoryProductSchema.parse(invocation.parse.output)
		: V1AnnouncementsWriterOutputSchema.parse(invocation.parse.output);
}

function refineTrack(trial: V5EvaluationTrial, trackName: "main_story" | "announcements", evidence: V1PreparedEvidence, context: z.RefinementCtx): void {
	const track = trial.tracks[trackName];
	const writerStep = trackName === "main_story" ? "main_story_write" : "announcements_write";
	const copyeditStep = trackName === "main_story" ? "main_story_copyedit" : "announcements_copyedit";
	const selectedWriter = trial.selected_invocation_ids[writerStep];
	const selectedCopyedit = trial.selected_invocation_ids[copyeditStep];
	const terminal = track.lifecycle === "completed" || track.lifecycle === "rejected";
	if (selectedCopyedit !== null && selectedWriter === null) context.addIssue({ code: "custom", path: ["selected_invocation_ids", copyeditStep], message: "selected copyedit requires its selected parsed-success writer" });
	if (selectedWriter !== null && selectedCopyedit !== null) {
		if (trial.invocations.findIndex(({ id }) => id === selectedWriter) >= trial.invocations.findIndex(({ id }) => id === selectedCopyedit)) context.addIssue({ code: "custom", path: ["selected_invocation_ids", copyeditStep], message: "selected writer must execute before its selected copyedit" });
	}
	if (!terminal && (track.subject_outcome !== null || track.terminal_production_step !== null || track.product !== null || track.findings.length > 0)) context.addIssue({ code: "custom", path: ["tracks", trackName], message: "nonterminal track cannot retain terminal data" });
	if (terminal && (track.subject_outcome === null || track.terminal_production_step === null || stepTrack(track.terminal_production_step) !== trackName)) context.addIssue({ code: "custom", path: ["tracks", trackName], message: "terminal track must name its own outcome and production step" });
	if (track.findings.some(({ production_step }) => production_step !== copyeditStep)) context.addIssue({ code: "custom", path: ["tracks", trackName, "findings"], message: "diagnostics must belong to the track copyedit step" });
	if (track.findings.some(({ kind }) => kind !== "preservation" && kind !== "final_product")) context.addIssue({ code: "custom", path: ["tracks", trackName, "findings"], message: "completed-track diagnostics must be preservation or final-product findings" });
	if (track.lifecycle === "completed") {
		if (track.subject_outcome !== "completed" || track.terminal_production_step !== copyeditStep || track.product === null || selectedWriter === null || selectedCopyedit === null) context.addIssue({ code: "custom", path: ["tracks", trackName], message: "completed track requires selected writer and copyedit, completed outcome, and retained product" });
		const writerOutput = selectedWriterOutput(trial, trackName);
		const copyedit = trial.invocations.find(({ id }) => id === selectedCopyedit);
		if (writerOutput !== undefined && copyedit?.transport === "succeeded") {
			try {
				const diagnostics = expectedVersion5Diagnostics(trackName, writerOutput, copyedit.completion.text, evidence);
				if (!canonicallyEqual(track.findings, diagnostics)) context.addIssue({ code: "custom", path: ["tracks", trackName, "findings"], message: "completed-track diagnostics must equal exact frozen version 5 re-derivation" });
			} catch {
				context.addIssue({ code: "custom", path: ["tracks", trackName, "product"], message: "completed product must match the frozen artifact version 5 contract" });
			}
		}
	}
	if (track.lifecycle === "rejected") {
		if (track.subject_outcome === "completed" || track.subject_outcome !== trackOutcome(trial, trackName)) context.addIssue({ code: "custom", path: ["tracks", trackName, "subject_outcome"], message: "rejected track outcome must match malformed JSON, schema mismatch, or infrastructure evidence" });
		if (track.product !== null || track.findings.length !== 0) context.addIssue({ code: "custom", path: ["tracks", trackName], message: "rejected track cannot retain a product or non-schema diagnostics" });
		if (track.terminal_production_step === copyeditStep && selectedWriter === null) context.addIssue({ code: "custom", path: ["selected_invocation_ids", writerStep], message: "copyedit-terminal rejection requires a selected writer" });
		if (track.terminal_production_step === writerStep && trial.invocations.some(({ production_step }) => production_step === copyeditStep)) context.addIssue({ code: "custom", path: ["invocations"], message: "writer-terminal rejection forbids every copyedit invocation" });
	}
}

export function refineVersion5Trial(trial: V5EvaluationTrial, evidence: V1PreparedEvidence, benchmarkStartedAt: string, context: z.RefinementCtx, trialIndex: number): void {
	const trialPath = ["trials", trialIndex] as const;
	const trialContext: z.RefinementCtx = {
		value: context.value,
		issues: context.issues,
		addIssue(issue) {
			if (typeof issue === "string") context.addIssue({ code: "custom", path: [...trialPath], message: issue });
			else context.addIssue({ ...issue, path: [...trialPath, ...(issue.path ?? [])] });
		},
	};
	refineInvocationRoster(trial, benchmarkStartedAt, trialContext);
	refineSelections(trial, trialContext);
	for (const trackName of ["main_story", "announcements"] as const) refineTrack(trial, trackName, evidence, trialContext);
	refineVersion5ParserPromptAndProductRelations(trial, evidence, trialContext);
	if (trial.lifecycle === "running" && (trial.completed_at !== null || trial.subject_outcome !== null)) trialContext.addIssue({ code: "custom", path: ["lifecycle"], message: "running trial cannot be terminal" });
	if (trial.lifecycle !== "complete") return;
	if (trial.completed_at === null || trial.subject_outcome === null || Object.values(trial.tracks).some(({ lifecycle }) => lifecycle !== "completed" && lifecycle !== "rejected")) trialContext.addIssue({ code: "custom", path: ["lifecycle"], message: "complete trial requires terminal tracks, time, and outcome" });
	if (trial.invocations.some((invocation) => invocation.transport === "in_flight" || (invocation.transport === "failed" && invocation.retry_classification.state === "pending") || (invocation.transport === "succeeded" && invocation.parse.state === "pending"))) trialContext.addIssue({ code: "custom", path: ["invocations"], message: "complete trial cannot retain pending invocation work" });
	if (trial.subject_outcome !== deriveVersion5TrialOutcome(trial)) trialContext.addIssue({ code: "custom", path: ["subject_outcome"], message: "trial outcome must match its terminal tracks" });
	if (trial.completed_at !== null) {
		const latestReached = Math.max(Date.parse(trial.started_at), ...trial.invocations.flatMap((invocation) => invocation.transport === "in_flight" ? [Date.parse(invocation.started_at)] : [Date.parse(invocation.started_at), Date.parse(invocation.ended_at)]));
		if (Date.parse(trial.completed_at) < latestReached) trialContext.addIssue({ code: "custom", path: ["completed_at"], message: "trial completion cannot precede reached invocation timing or trial start" });
	}
}
