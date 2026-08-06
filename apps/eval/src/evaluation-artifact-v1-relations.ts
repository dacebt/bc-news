import type { z } from "zod";
import { EvaluationFindingSchema, canonicallyEqual, type EvaluationTrial } from "./evaluation-artifact-schemas";
import {
	V1AnnouncementsWriterOutputSchema, V1MainStoryProductSchema,
	type V1PreparedEvidence, type V1WriterOutput,
} from "./evaluation-artifact-v1-contracts";
import { findV1AnnouncementsFinalProductFailures, findV1MainStoryFinalProductFailures } from "./evaluation-artifact-v1-final-product";
import {
	V1_COPYEDIT_SYSTEM_CONSTRAINTS, V1CopyeditPreservationError, V1EditorialOutputError,
	buildV1CopyeditPrompt, parseV1Completion,
} from "./evaluation-artifact-v1-parser";
import { V1_WRITER_SYSTEM_CONSTRAINTS, buildV1WriterPrompt } from "./evaluation-artifact-v1-writer-prompts";

function version1Finding(error: unknown): z.infer<typeof EvaluationFindingSchema> | undefined {
	if (error instanceof V1EditorialOutputError) {
		return { kind: error.code, production_step: error.productionStep, code: error.code, message: error.message };
	}
	if (error instanceof V1CopyeditPreservationError) {
		return { kind: "preservation", production_step: error.productionStep, code: error.code, message: error.message };
	}
	return undefined;
}

function addVersion1ParseIssue(context: z.RefinementCtx, index: number, message: string): void {
	context.addIssue({ code: "custom", path: ["invocations", index, "parse"], message });
}

export function refineVersion1ParserPromptAndProductRelations(
	trial: EvaluationTrial,
	evidence: V1PreparedEvidence,
	context: z.RefinementCtx,
): void {
	const selectedWriterOutputs = new Map<"main_story" | "announcements", V1WriterOutput>();
	for (const trackName of ["main_story", "announcements"] as const) {
		const writerStep = trackName === "main_story" ? "main_story_write" : "announcements_write";
		const copyeditStep = trackName === "main_story" ? "main_story_copyedit" : "announcements_copyedit";
		const writerId = trial.selected_invocation_ids[writerStep];
		const writer = writerId === null ? undefined : trial.invocations.find(({ id }) => id === writerId);
		const expectedWriterUser = buildV1WriterPrompt(trackName, evidence);
		for (const reachedWriter of trial.invocations.filter(({ production_step }) => production_step === writerStep)) {
			if (reachedWriter.request.system !== V1_WRITER_SYSTEM_CONSTRAINTS || reachedWriter.request.user !== expectedWriterUser) {
				context.addIssue({ code: "custom", path: ["invocations", trial.invocations.indexOf(reachedWriter), "request"], message: "every reached writer request must derive exactly from the retained prepared-evidence snapshot under artifact version 1" });
			}
		}
		const copyeditInvocations = trial.invocations.filter(({ production_step }) => production_step === copyeditStep);
		let writerOutput: V1WriterOutput | undefined;
		if (writer?.transport === "succeeded" && writer.parse.state === "succeeded") {
			try {
				writerOutput = trackName === "main_story"
					? V1MainStoryProductSchema.parse(parseV1Completion(writerStep, writer.completion.text))
					: V1AnnouncementsWriterOutputSchema.parse(parseV1Completion(writerStep, writer.completion.text));
				if (!canonicallyEqual(writerOutput, writer.parse.output)) {
					context.addIssue({ code: "custom", path: ["selected_invocation_ids", writerStep], message: "selected writer parse output must equal the artifact version 1 parser result from its retained completion" });
					writerOutput = undefined;
				}
			} catch {
				context.addIssue({ code: "custom", path: ["selected_invocation_ids", writerStep], message: "selected writer completion must parse successfully under artifact version 1" });
			}
		}
		if (writerOutput !== undefined) selectedWriterOutputs.set(trackName, writerOutput);
		if (copyeditInvocations.length > 0 && writerOutput === undefined) {
			context.addIssue({ code: "custom", path: ["selected_invocation_ids", writerStep], message: "every reached copyedit invocation requires a selected writer validated from its retained completion under artifact version 1" });
			continue;
		}
		if (writerOutput === undefined) continue;
		const expectedUser = buildV1CopyeditPrompt(trackName, writerOutput);
		for (const copyedit of copyeditInvocations) {
			if (copyedit.request.system !== V1_COPYEDIT_SYSTEM_CONSTRAINTS || copyedit.request.user !== expectedUser) {
				context.addIssue({ code: "custom", path: ["invocations", trial.invocations.indexOf(copyedit), "request"], message: "every reached copyedit request must derive exactly from its selected writer completion under artifact version 1" });
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
				? selectedWriterOutputs.get("announcements") : undefined;
		if (invocation.production_step.endsWith("copyedit") && writerOutput === undefined) continue;
		try {
			const parsed = parseV1Completion(invocation.production_step, invocation.completion.text, writerOutput);
			if (invocation.parse.state !== "succeeded") addVersion1ParseIssue(context, index, "retained rejection contradicts successful artifact version 1 parsing of the retained completion");
			else if (!canonicallyEqual(parsed, invocation.parse.output)) addVersion1ParseIssue(context, index, "retained parse output must equal the artifact version 1 parser result from the retained completion");
		} catch (error: unknown) {
			const finding = version1Finding(error);
			if (finding === undefined) addVersion1ParseIssue(context, index, "artifact version 1 parser failed without a stable evaluation finding");
			else if (invocation.parse.state !== "rejected" || !canonicallyEqual(invocation.parse.findings, [finding])) addVersion1ParseIssue(context, index, "retained parse rejection must exactly match the artifact version 1 parser finding from the retained completion");
		}
	}
}

export function expectedFinalProductFindings(
	trackName: "main_story" | "announcements",
	product: Record<string, unknown>,
	evidence: V1PreparedEvidence,
): z.infer<typeof EvaluationFindingSchema>[] {
	const productionStep = trackName === "main_story" ? "main_story_copyedit" : "announcements_copyedit";
	const messages = trackName === "main_story"
		? findV1MainStoryFinalProductFailures(V1MainStoryProductSchema.parse(product), evidence)
		: findV1AnnouncementsFinalProductFailures(V1AnnouncementsWriterOutputSchema.parse(product), evidence);
	return messages.map((message, index) => ({ kind: "final_product", production_step: productionStep, code: `final_product_${index + 1}`, message }));
}
