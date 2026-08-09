import type { z } from "zod";
import { EvaluationFindingSchema, canonicallyEqual } from "./evaluation-artifact-schemas";
import {
	V1AnnouncementsWriterOutputSchema,
	V1MainStoryProductSchema,
	type V1PreparedEvidence,
	type V1WriterOutput,
} from "./evaluation-artifact-v1-contracts";
import {
	V3_COPYEDIT_SYSTEM_CONSTRAINTS,
	buildV3CopyeditPrompt,
} from "./evaluation-artifact-v3-parser";
import { V3_WRITER_SYSTEM_CONSTRAINTS, buildV3WriterPrompt } from "./evaluation-artifact-v3-writer-prompts";
import {
	v5AnnouncementsFinalProductDiagnostics,
	v5MainStoryFinalProductDiagnostics,
} from "./evaluation-artifact-v5-diagnostics";
import { V5EditorialOutputError, parseV5Completion } from "./evaluation-artifact-v5-parser";
import type { V5EvaluationTrial } from "./evaluation-artifact-v5";

type Finding = z.infer<typeof EvaluationFindingSchema>;

function outputFinding(error: V5EditorialOutputError): Finding {
	return { kind: error.code, production_step: error.productionStep, code: error.code, message: error.message };
}

function addParseIssue(context: z.RefinementCtx, index: number, message: string): void {
	context.addIssue({ code: "custom", path: ["invocations", index, "parse"], message });
}

export function refineVersion5ParserPromptAndProductRelations(
	trial: V5EvaluationTrial,
	evidence: V1PreparedEvidence,
	context: z.RefinementCtx,
): void {
	const selectedWriterOutputs = new Map<"main_story" | "announcements", V1WriterOutput>();
	for (const trackName of ["main_story", "announcements"] as const) {
		const writerStep = trackName === "main_story" ? "main_story_write" : "announcements_write";
		const copyeditStep = trackName === "main_story" ? "main_story_copyedit" : "announcements_copyedit";
		const writerId = trial.selected_invocation_ids[writerStep];
		const writer = writerId === null ? undefined : trial.invocations.find(({ id }) => id === writerId);
		const expectedWriterUser = buildV3WriterPrompt(trackName, evidence);
		for (const reachedWriter of trial.invocations.filter(({ production_step }) => production_step === writerStep)) {
			if (reachedWriter.request.system !== V3_WRITER_SYSTEM_CONSTRAINTS || reachedWriter.request.user !== expectedWriterUser) {
				context.addIssue({ code: "custom", path: ["invocations", trial.invocations.indexOf(reachedWriter), "request"], message: "every reached writer request must derive exactly from retained prepared evidence under artifact version 5" });
			}
		}
		const copyeditInvocations = trial.invocations.filter(({ production_step }) => production_step === copyeditStep);
		let writerOutput: V1WriterOutput | undefined;
		if (writer?.transport === "succeeded" && writer.parse.state === "succeeded") {
			try {
				const parsed = parseV5Completion(writerStep, writer.completion.text).output;
				writerOutput = trackName === "main_story"
					? V1MainStoryProductSchema.parse(parsed)
					: V1AnnouncementsWriterOutputSchema.parse(parsed);
				if (!canonicallyEqual(writerOutput, writer.parse.output)) {
					context.addIssue({ code: "custom", path: ["selected_invocation_ids", writerStep], message: "selected writer parse output must equal artifact version 5 parsing of its retained completion" });
					writerOutput = undefined;
				}
			} catch {
				context.addIssue({ code: "custom", path: ["selected_invocation_ids", writerStep], message: "selected writer completion must parse successfully under artifact version 5" });
			}
		}
		if (writerOutput !== undefined) selectedWriterOutputs.set(trackName, writerOutput);
		if (copyeditInvocations.length > 0 && writerOutput === undefined) {
			context.addIssue({ code: "custom", path: ["selected_invocation_ids", writerStep], message: "every reached copyedit requires a selected writer validated from retained completion under artifact version 5" });
			continue;
		}
		if (writerOutput === undefined) continue;
		const expectedUser = buildV3CopyeditPrompt(trackName, writerOutput);
		for (const copyedit of copyeditInvocations) {
			if (copyedit.request.system !== V3_COPYEDIT_SYSTEM_CONSTRAINTS || copyedit.request.user !== expectedUser) {
				context.addIssue({ code: "custom", path: ["invocations", trial.invocations.indexOf(copyedit), "request"], message: "every reached copyedit request must derive exactly from its selected writer completion under artifact version 5" });
			}
		}
		const track = trial.tracks[trackName];
		const selectedCopyeditId = trial.selected_invocation_ids[copyeditStep];
		const selectedCopyedit = selectedCopyeditId === null ? undefined : trial.invocations.find(({ id }) => id === selectedCopyeditId);
		if (track.product !== null && selectedCopyedit?.transport === "succeeded" && selectedCopyedit.parse.state === "succeeded" && !canonicallyEqual(track.product, selectedCopyedit.parse.output)) {
			context.addIssue({ code: "custom", path: ["tracks", trackName, "product"], message: "retained product must equal the selected terminal copyedit output" });
		}
	}

	for (const [index, invocation] of trial.invocations.entries()) {
		if (invocation.transport !== "succeeded" || invocation.parse.state === "pending") continue;
		const writerOutput = invocation.production_step === "main_story_copyedit"
			? selectedWriterOutputs.get("main_story")
			: invocation.production_step === "announcements_copyedit"
				? selectedWriterOutputs.get("announcements")
				: undefined;
		if (invocation.production_step.endsWith("copyedit") && writerOutput === undefined) continue;
		try {
			const parsed = parseV5Completion(invocation.production_step, invocation.completion.text, writerOutput).output;
			if (invocation.parse.state !== "succeeded") addParseIssue(context, index, "retained rejection contradicts successful artifact version 5 schema parsing");
			else if (!canonicallyEqual(parsed, invocation.parse.output)) addParseIssue(context, index, "retained parse output must equal artifact version 5 parsing of the retained completion");
		} catch (error: unknown) {
			if (!(error instanceof V5EditorialOutputError)) addParseIssue(context, index, "artifact version 5 parser failed without a stable contract finding");
			else if (invocation.parse.state !== "rejected" || !canonicallyEqual(invocation.parse.findings, [outputFinding(error)])) addParseIssue(context, index, "retained parse rejection must exactly match artifact version 5 schema parsing");
		}
	}
}

export function expectedVersion5Diagnostics(
	trackName: "main_story" | "announcements",
	writerOutput: V1WriterOutput,
	copyeditText: string,
	evidence: V1PreparedEvidence,
): Finding[] {
	const parsed = parseV5Completion(
		trackName === "main_story" ? "main_story_copyedit" : "announcements_copyedit",
		copyeditText,
		writerOutput,
	);
	return [
		...parsed.diagnostics,
		...(trackName === "main_story"
			? v5MainStoryFinalProductDiagnostics(V1MainStoryProductSchema.parse(parsed.output), evidence)
			: v5AnnouncementsFinalProductDiagnostics(V1AnnouncementsWriterOutputSchema.parse(parsed.output), evidence)),
	];
}
