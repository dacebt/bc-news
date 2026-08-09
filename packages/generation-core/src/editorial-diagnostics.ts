import { z } from "zod";
import type { AnnouncementsProduct } from "./announcements";
import type { MainStoryProduct } from "./main-story";
import type { PreparedEvidence } from "./prepared-evidence";

const CopyeditStepSchema = z.enum(["main_story_copyedit", "announcements_copyedit"]);

export const PreservationDiagnosticCodeSchema = z.enum([
	"announcement_count",
	"announcement_identity",
	"field_shape",
	"paragraph_count",
	"quoted_span",
	"numeric_literal",
	"protected_markdown",
	"protected_value",
]);

export const FinalProductDiagnosticCodeSchema = z.enum([
	"forbidden_marker",
	"ungrounded_marked_name",
	"ungrounded_quote",
]);

export const PreservationDiagnosticSchema = z.strictObject({
	kind: z.literal("preservation"),
	production_step: CopyeditStepSchema,
	code: PreservationDiagnosticCodeSchema,
	message: z.string().min(1),
});

export const FinalProductDiagnosticSchema = z.strictObject({
	kind: z.literal("final_product"),
	production_step: CopyeditStepSchema,
	code: FinalProductDiagnosticCodeSchema,
	message: z.string().min(1),
});

export const EditorialDiagnosticSchema = z.discriminatedUnion("kind", [
	PreservationDiagnosticSchema,
	FinalProductDiagnosticSchema,
]);

export type PreservationDiagnosticCode = z.infer<typeof PreservationDiagnosticCodeSchema>;
export type PreservationDiagnostic = z.infer<typeof PreservationDiagnosticSchema>;
export type FinalProductDiagnostic = z.infer<typeof FinalProductDiagnosticSchema>;
export type EditorialDiagnostic = z.infer<typeof EditorialDiagnosticSchema>;

const FORBIDDEN_PATTERNS = [
	/ignore\s+previous\s+instructions/iu,
	/system\s+prompt/iu,
	/developer\s+message/iu,
	/as\s+(?:an?\s+)?AI\b/iu,
	/```/u,
	/^#{1,6}\s/mu,
	/—/u,
] as const;

function normalized(value: string): string {
	return value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/gu, " ").trim();
}

function preparedEvidenceSource(preparedEvidence: PreparedEvidence): string {
	return normalized(
		preparedEvidence.messages.map((message) => `${message.author_name} ${message.text}`).join(" "),
	);
}

function finalProductDiagnostics(input: {
	productionStep: "main_story_copyedit" | "announcements_copyedit";
	editorialText: readonly string[];
	groundedText: string;
	preparedEvidence: PreparedEvidence;
}): FinalProductDiagnostic[] {
	const diagnostics: FinalProductDiagnostic[] = [];
	const joinedEditorialText = input.editorialText.join("\n");
	for (const pattern of FORBIDDEN_PATTERNS) {
		const match = pattern.exec(joinedEditorialText);
		if (match !== null) {
			diagnostics.push({
				kind: "final_product",
				production_step: input.productionStep,
				code: "forbidden_marker",
				message: `Forbidden output marker: ${match[0]}`,
			});
		}
	}

	const source = preparedEvidenceSource(input.preparedEvidence);
	for (const match of input.groundedText.matchAll(/\*\*([^*]+)\*\*/gu)) {
		const marked = normalized(match[1] ?? "");
		if (marked !== "" && !source.includes(marked)) {
			diagnostics.push({
				kind: "final_product",
				production_step: input.productionStep,
				code: "ungrounded_marked_name",
				message: `Ungrounded marked name: ${match[1]}`,
			});
		}
	}
	for (const match of input.groundedText.matchAll(/["“]([^"”]{2,})["”]/gu)) {
		const quote = normalized(match[1] ?? "");
		if (quote !== "" && !source.includes(quote)) {
			diagnostics.push({
				kind: "final_product",
				production_step: input.productionStep,
				code: "ungrounded_quote",
				message: `Ungrounded quote: ${match[1]}`,
			});
		}
	}
	return diagnostics;
}

export function mainStoryFinalProductDiagnostics(
	mainStory: MainStoryProduct,
	preparedEvidence: PreparedEvidence,
): FinalProductDiagnostic[] {
	return finalProductDiagnostics({
		productionStep: "main_story_copyedit",
		editorialText: [
			mainStory.title,
			mainStory.subtitle,
			mainStory.main_story.headline,
			mainStory.main_story.lede,
			mainStory.main_story.body,
		],
		groundedText: [
			mainStory.main_story.headline,
			mainStory.main_story.lede,
			mainStory.main_story.body,
		].join(" "),
		preparedEvidence,
	});
}

export function announcementsFinalProductDiagnostics(
	announcements: AnnouncementsProduct,
	preparedEvidence: PreparedEvidence,
): FinalProductDiagnostic[] {
	return finalProductDiagnostics({
		productionStep: "announcements_copyedit",
		editorialText: announcements.announcements.flatMap(
			(announcement) => [announcement.title, announcement.summary],
		),
		groundedText: announcements.announcements.flatMap(
			(announcement) => [announcement.title, announcement.summary],
		).join(" "),
		preparedEvidence,
	});
}
