import type { ProductionModelStep } from "@bc-news/generation-core";
import type { z } from "zod";
import { SubjectOutcomeSchema, type EvaluationTrial } from "./evaluation-artifact-schemas";

export function stepTrack(step: ProductionModelStep): "main_story" | "announcements" {
	return step.startsWith("main_story") ? "main_story" : "announcements";
}

function derivedTrackOutcome(trial: EvaluationTrial, trackName: "main_story" | "announcements"): z.infer<typeof SubjectOutcomeSchema> {
	const track = trial.tracks[trackName];
	if (track.lifecycle === "completed") return "completed";
	const terminalStep = track.terminal_production_step;
	if (terminalStep === null) return "infrastructure_incomplete";
	const terminalInvocations = trial.invocations.filter(({ production_step }) => production_step === terminalStep);
	const selectedId = trial.selected_invocation_ids[terminalStep];
	const selected = selectedId === null ? undefined : terminalInvocations.find(({ id }) => id === selectedId);
	const terminalInvocation = selected ?? terminalInvocations.at(-1);
	const findings = [
		...track.findings,
		...(terminalInvocation?.parse.state === "rejected" ? terminalInvocation.parse.findings : []),
	];
	for (const [kind, outcome] of [
		["invalid_json", "parse_rejected"],
		["contract_mismatch", "contract_rejected"],
		["preservation", "preservation_rejected"],
		["final_product", "final_product_rejected"],
	] as const) {
		if (findings.some((finding) => finding.kind === kind)) return outcome;
	}
	return terminalInvocation?.transport === "failed" ? "infrastructure_incomplete" : "completed";
}

const SUBJECT_OUTCOME_PRECEDENCE = [
	"infrastructure_incomplete", "parse_rejected", "contract_rejected",
	"preservation_rejected", "final_product_rejected", "completed",
] as const satisfies readonly z.infer<typeof SubjectOutcomeSchema>[];

export function deriveEvaluationTrialOutcome(trial: EvaluationTrial): z.infer<typeof SubjectOutcomeSchema> {
	const outcomes = new Set([derivedTrackOutcome(trial, "main_story"), derivedTrackOutcome(trial, "announcements")]);
	return SUBJECT_OUTCOME_PRECEDENCE.find((outcome) => outcomes.has(outcome)) ?? "completed";
}

export { derivedTrackOutcome };
