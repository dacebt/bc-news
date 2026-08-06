import { z } from "zod";
import { AnnouncementSchema } from "@bc-news/contracts";
import { assertCopyeditPreservesTextFields, CopyeditPreservationError } from "./copyedit-preservation";
import { EditorialOutputContractError } from "./main-story";
import type { PreparedEvidence } from "./prepared-evidence";
import { fenceUntrustedJson, fenceUntrustedTranscript } from "./untrusted-data-fence";

export const AnnouncementsProductSchema = z.strictObject({
	announcements: z.array(AnnouncementSchema),
});

export const AnnouncementsDraftSchema = AnnouncementsProductSchema;
export const AnnouncementsWriterOutputSchema = AnnouncementsProductSchema;

export type AnnouncementsDraft = z.infer<typeof AnnouncementsDraftSchema>;
export type AnnouncementsProduct = z.infer<typeof AnnouncementsProductSchema>;

const AnnouncementInternalIdSchema = z.string().regex(/^announcement-[1-9]\d*$/u);

export const IdentifiedAnnouncementSchema = AnnouncementSchema.extend({
	id: AnnouncementInternalIdSchema,
});

export const IdentifiedAnnouncementsDraftSchema = z.strictObject({
	announcements: z.array(IdentifiedAnnouncementSchema),
});

export const AnnouncementsCopyeditOutputSchema = IdentifiedAnnouncementsDraftSchema;

export type IdentifiedAnnouncementsDraft = z.infer<typeof IdentifiedAnnouncementsDraftSchema>;

export function buildAnnouncementsWriterPrompt(preparedEvidence: PreparedEvidence): string {
	return `[YOUR ASSIGNMENT]
Region: ${preparedEvidence.active_region_id}
Date: ${preparedEvidence.publication_date}
Messages analyzed: ${preparedEvidence.final_count}

Extract every noteworthy achievement and milestone from the chat messages, including skill progressions, personal completions, discoveries, territorial claims, technical achievements, and unlocks. Treat skill grinding as ordinary economic activity and report it without irony. If there are no noteworthy achievements, return an empty announcements array.

[REPORTING]
- Include names and the accomplishment actually evidenced;
- Use a straightforward factual style;
- Do not rank announcements or select only the most prominent;
- Never invent facts, numbers, names, or quotations.

[CHAT MESSAGES]
${fenceUntrustedTranscript(preparedEvidence)}

[OUTPUT]
Return valid JSON:
{
  "announcements": [
    {
      "title": "Brief achievement headline, plain text",
      "summary": "What was accomplished, with markdown only for player names and emphasis"
    }
  ]
}`;
}

export function parseAnnouncementsWriterOutput(text: string): AnnouncementsDraft {
	let candidate: unknown;
	try {
		candidate = JSON.parse(text);
	} catch (cause) {
		throw new EditorialOutputContractError(
			"announcements_write",
			"invalid_json",
			"announcements_write model output is not valid JSON",
			{ cause },
		);
	}
	const result = AnnouncementsWriterOutputSchema.safeParse(candidate);
	if (!result.success) {
		throw new EditorialOutputContractError(
			"announcements_write",
			"contract_mismatch",
			`announcements_write model output does not match its strict contract: ${result.error.message}`,
		);
	}
	return result.data;
}

export function attachAnnouncementIds(draft: AnnouncementsDraft): IdentifiedAnnouncementsDraft {
	return {
		announcements: draft.announcements.map((announcement, index) => ({
			id: `announcement-${index + 1}`,
			...announcement,
		})),
	};
}

export function buildAnnouncementsCopyeditPrompt(draft: IdentifiedAnnouncementsDraft): string {
	return `[YOUR ASSIGNMENT]
Copyedit the filed announcements. Make only grammar, spelling, punctuation, and clarity corrections permitted by your system instructions. Preserve every announcement and its exact id at the same array index. Return the complete product, including each id.

${fenceUntrustedJson("ANNOUNCEMENTS DRAFT", draft)}

[OUTPUT]
Return the same JSON shape with an announcements array whose items contain id, title, and summary.`;
}

function parseIdentifiedAnnouncementsCopyeditOutput(text: string): IdentifiedAnnouncementsDraft {
	let candidate: unknown;
	try {
		candidate = JSON.parse(text);
	} catch (cause) {
		throw new EditorialOutputContractError(
			"announcements_copyedit",
			"invalid_json",
			"announcements_copyedit model output is not valid JSON",
			{ cause },
		);
	}
	const result = AnnouncementsCopyeditOutputSchema.safeParse(candidate);
	if (!result.success) {
		throw new EditorialOutputContractError(
			"announcements_copyedit",
			"contract_mismatch",
			`announcements_copyedit model output does not match its strict contract: ${result.error.message}`,
		);
	}
	return result.data;
}

export function parseAnnouncementsCopyeditOutput(
	text: string,
	draft: IdentifiedAnnouncementsDraft,
): AnnouncementsProduct {
	const edited = parseIdentifiedAnnouncementsCopyeditOutput(text);
	if (edited.announcements.length !== draft.announcements.length) {
		throw new CopyeditPreservationError(
			"announcements_copyedit",
			"announcement_count",
			"Copyedit changed the announcement count",
		);
	}
	for (let index = 0; index < draft.announcements.length; index += 1) {
		const before = draft.announcements[index]!;
		const after = edited.announcements[index]!;
		if (after.id !== before.id) {
			throw new CopyeditPreservationError(
				"announcements_copyedit",
				"announcement_identity",
				`Copyedit changed or reordered announcement id ${before.id} at index ${index}`,
			);
		}
		assertCopyeditPreservesTextFields(
			"announcements_copyedit",
			[
				[`announcements.${index}.title`, before.title, after.title],
				[`announcements.${index}.summary`, before.summary, after.summary],
			],
		);
	}
	return AnnouncementsProductSchema.parse({
		announcements: edited.announcements.map(({ title, summary }) => ({ title, summary })),
	});
}
