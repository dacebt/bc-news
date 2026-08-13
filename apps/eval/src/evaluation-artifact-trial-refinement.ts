import type { z } from "zod";
import {
	EvaluationFindingSchema, canonicallyEqual,
	type EvaluationTrial, type StepInvocation,
} from "./evaluation-artifact-schemas";
import { derivedTrackOutcome, deriveEvaluationTrialOutcome, stepTrack } from "./evaluation-artifact-outcomes";
import { V1_PRODUCTION_MODEL_STEPS, type V1PreparedEvidence, type V1ProductionModelStep } from "./evaluation-artifact-v1-contracts";
import { expectedFinalProductFindings, refineVersion1ParserPromptAndProductRelations } from "./evaluation-artifact-v1-relations";

function refineInvocationRoster(trial: EvaluationTrial, benchmarkStartedAt: string, context: z.RefinementCtx): void {
	const ids = new Set<string>();
	const previousByStep = new Map<V1ProductionModelStep, StepInvocation>();
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
			if (invocation.predecessor_invocation_id !== predecessor.id) context.addIssue({ code: "custom", path: ["invocations", index, "predecessor_invocation_id"], message: "later invocation must point to the immediately previous invocation for the same config and production step" });
			if (predecessor.transport !== "failed" || predecessor.retry_classification.state !== "classified" || !predecessor.retry_classification.eligible) context.addIssue({ code: "custom", path: ["invocations", index, "predecessor_invocation_id"], message: "retry predecessor must be a classified eligible transport failure" });
			if (!canonicallyEqual(invocation.request, predecessor.request) || invocation.request_sha256 !== predecessor.request_sha256) context.addIssue({ code: "custom", path: ["invocations", index, "request"], message: "retry request and request hash must equal its predecessor exactly" });
		}
		previousByStep.set(invocation.production_step, invocation);
		if (invocation.parse.state === "rejected" && invocation.parse.findings.some(({ production_step }) => production_step !== invocation.production_step)) context.addIssue({ code: "custom", path: ["invocations", index, "parse", "findings"], message: "parse findings must belong to their invocation step" });
	}
}

function refineSelections(trial: EvaluationTrial, context: z.RefinementCtx): void {
	for (const step of V1_PRODUCTION_MODEL_STEPS) {
		const selectedId = trial.selected_invocation_ids[step];
		if (selectedId === null) continue;
		const selected = trial.invocations.find(({ id }) => id === selectedId);
		if (selected === undefined || selected.production_step !== step || selected.config_identity !== trial.config_identity || selected.transport !== "succeeded" || selected.parse.state !== "succeeded") {
			context.addIssue({ code: "custom", path: ["selected_invocation_ids", step], message: "selected invocation must resolve to a parsed success for the same step and config" });
		}
	}
}

function refineTrack(trial: EvaluationTrial, trackName: "main_story" | "announcements", evidence: V1PreparedEvidence, context: z.RefinementCtx): void {
	const track = trial.tracks[trackName];
	const writerStep = trackName === "main_story" ? "main_story_write" : "announcements_write";
	const copyeditStep = trackName === "main_story" ? "main_story_copyedit" : "announcements_copyedit";
	const selectedWriter = trial.selected_invocation_ids[writerStep];
	const selectedCopyedit = trial.selected_invocation_ids[copyeditStep];
	const terminal = track.lifecycle === "completed" || track.lifecycle === "rejected";
	if (selectedCopyedit !== null && selectedWriter === null) context.addIssue({ code: "custom", path: ["selected_invocation_ids", copyeditStep], message: "selected copyedit requires its selected parsed-success writer" });
	if (selectedWriter !== null && selectedCopyedit !== null) {
		const writerIndex = trial.invocations.findIndex(({ id }) => id === selectedWriter);
		const copyeditIndex = trial.invocations.findIndex(({ id }) => id === selectedCopyedit);
		if (writerIndex >= copyeditIndex) context.addIssue({ code: "custom", path: ["selected_invocation_ids", copyeditStep], message: "selected writer must execute before its selected copyedit" });
	}
	if (!terminal && (track.subject_outcome !== null || track.terminal_production_step !== null || track.product !== null || track.findings.length > 0)) context.addIssue({ code: "custom", path: ["tracks", trackName], message: "nonterminal track cannot retain terminal data" });
	if (terminal && (track.subject_outcome === null || track.terminal_production_step === null || stepTrack(track.terminal_production_step) !== trackName)) context.addIssue({ code: "custom", path: ["tracks", trackName], message: "terminal track must name its own outcome and production step" });
	if (track.findings.some(({ production_step }) => stepTrack(production_step) !== trackName)) context.addIssue({ code: "custom", path: ["tracks", trackName, "findings"], message: "track findings must belong to that track" });
	if (track.lifecycle === "completed" && (track.subject_outcome !== "completed" || track.terminal_production_step !== copyeditStep || track.product === null || track.findings.length !== 0)) context.addIssue({ code: "custom", path: ["tracks", trackName], message: "completed track requires terminal copyedit product without findings" });
	if (track.lifecycle === "completed" && (selectedWriter === null || selectedCopyedit === null)) context.addIssue({ code: "custom", path: ["selected_invocation_ids"], message: "completed track requires selected writer and copyedit invocations" });
	if (track.lifecycle === "rejected") {
		if (track.subject_outcome === "completed" || track.subject_outcome !== derivedTrackOutcome(trial, trackName)) context.addIssue({ code: "custom", path: ["tracks", trackName, "subject_outcome"], message: "rejected track outcome must match retained failure evidence" });
		if (track.product !== null && track.subject_outcome !== "final_product_rejected") context.addIssue({ code: "custom", path: ["tracks", trackName, "product"], message: "only final-product rejection may retain a product" });
		if (track.subject_outcome !== "final_product_rejected" && (track.product !== null || track.findings.length !== 0)) context.addIssue({ code: "custom", path: ["tracks", trackName], message: "non-final-product rejection requires null product and zero track findings" });
		if (track.subject_outcome === "final_product_rejected" && (track.product === null || selectedWriter === null || selectedCopyedit === null || track.findings.length === 0)) context.addIssue({ code: "custom", path: ["tracks", trackName], message: "final-product rejection requires selected writer and copyedit product with nonempty exact findings" });
		if (track.findings.some(({ kind, production_step }) => kind !== "final_product" || !production_step.endsWith("copyedit") || production_step !== track.terminal_production_step)) context.addIssue({ code: "custom", path: ["tracks", trackName, "findings"], message: "track findings must be final-product findings at terminal copyedit" });
		if (track.terminal_production_step === copyeditStep && selectedWriter === null) context.addIssue({ code: "custom", path: ["selected_invocation_ids", writerStep], message: "copyedit-terminal rejection requires a selected writer invocation" });
		if (track.terminal_production_step === writerStep && trial.invocations.some(({ production_step }) => production_step === copyeditStep)) context.addIssue({ code: "custom", path: ["invocations"], message: "writer-terminal rejection forbids every copyedit invocation" });
	}
	if (track.product !== null && track.terminal_production_step !== null && trial.selected_invocation_ids[track.terminal_production_step] === null) context.addIssue({ code: "custom", path: ["selected_invocation_ids", track.terminal_production_step], message: "retained final product requires its terminal invocation selection" });
	if (track.product !== null && track.terminal_production_step === copyeditStep) {
		let derived: z.infer<typeof EvaluationFindingSchema> | z.infer<typeof EvaluationFindingSchema>[] | undefined;
		try { derived = expectedFinalProductFindings(trackName, track.product, evidence); }
		catch { context.addIssue({ code: "custom", path: ["tracks", trackName, "product"], message: "retained product must match the frozen artifact version 1 product contract" }); }
		if (Array.isArray(derived)) {
			if (track.lifecycle === "completed" && derived.length > 0) context.addIssue({ code: "custom", path: ["tracks", trackName, "findings"], message: "completed track must have zero frozen version 1 final-product findings" });
			if (track.lifecycle === "completed" && track.findings.length !== 0) context.addIssue({ code: "custom", path: ["tracks", trackName, "findings"], message: "completed track must retain zero track findings" });
			if (track.subject_outcome === "final_product_rejected" && (derived.length === 0 || !canonicallyEqual(track.findings, derived))) context.addIssue({ code: "custom", path: ["tracks", trackName, "findings"], message: "final-product rejection findings must be the nonempty exact frozen version 1 re-derivation" });
		}
	}
}

export function refineTrial(
	trial: EvaluationTrial,
	evidence: V1PreparedEvidence,
	benchmarkStartedAt: string,
	context: z.RefinementCtx,
	trialIndex: number,
): void {
	const trialPath = ["trials", trialIndex] as const;
	const trialContext: z.RefinementCtx = {
		value: context.value,
		issues: context.issues,
		addIssue(issue) {
			if (typeof issue === "string") context.addIssue({ code: "custom", path: [...trialPath], message: issue });
			else context.addIssue({ ...issue, path: [...trialPath, ...(issue.path ?? [])] });
		},
	};
	for (const [index, invocation] of trial.invocations.entries()) {
		if (invocation.transport === "succeeded" && invocation.completion.text === null) {
			trialContext.addIssue({ code: "custom", path: ["invocations", index, "completion", "text"], message: "artifact versions 1 and 2 require textual completion content" });
		}
	}
	refineInvocationRoster(trial, benchmarkStartedAt, trialContext);
	refineSelections(trial, trialContext);
	for (const trackName of ["main_story", "announcements"] as const) refineTrack(trial, trackName, evidence, trialContext);
	refineVersion1ParserPromptAndProductRelations(trial, evidence, trialContext);
	if (trial.lifecycle === "running" && (trial.completed_at !== null || trial.subject_outcome !== null)) trialContext.addIssue({ code: "custom", path: ["lifecycle"], message: "running trial cannot be terminal" });
	if (trial.lifecycle !== "complete") return;
	if (trial.completed_at === null || trial.subject_outcome === null || Object.values(trial.tracks).some(({ lifecycle }) => lifecycle !== "completed" && lifecycle !== "rejected")) trialContext.addIssue({ code: "custom", path: ["lifecycle"], message: "complete trial requires terminal tracks, time, and outcome" });
	if (trial.invocations.some((invocation) => invocation.transport === "in_flight" || (invocation.transport === "failed" && invocation.retry_classification.state === "pending") || (invocation.transport === "succeeded" && invocation.parse.state === "pending"))) trialContext.addIssue({ code: "custom", path: ["invocations"], message: "complete trial cannot retain pending invocation work" });
	if (trial.subject_outcome !== deriveEvaluationTrialOutcome(trial)) trialContext.addIssue({ code: "custom", path: ["subject_outcome"], message: "trial outcome must match its terminal tracks" });
	if (trial.completed_at !== null) {
		const completedAt = Date.parse(trial.completed_at);
		const latestReached = Math.max(Date.parse(trial.started_at), ...trial.invocations.flatMap((invocation) => invocation.transport === "in_flight" ? [Date.parse(invocation.started_at)] : [Date.parse(invocation.started_at), Date.parse(invocation.ended_at)]));
		if (completedAt < latestReached) trialContext.addIssue({ code: "custom", path: ["completed_at"], message: "trial completion cannot precede reached invocation timing or trial start" });
	}
}
