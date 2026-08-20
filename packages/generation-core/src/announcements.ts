import { z } from "zod";
import { AnnouncementSchema } from "@bc-news/contracts";
import { EditorialOutputContractError } from "./main-story";
import { normalizeDecodedOutputStrings } from "./output-normalization";
import type { PreparedEvidence } from "./prepared-evidence";
import { fenceUntrustedTranscript } from "./untrusted-data-fence";

export const AnnouncementsProductSchema = z.strictObject({
	announcements: z.array(AnnouncementSchema),
});

export const AnnouncementsDraftSchema = AnnouncementsProductSchema;
export const AnnouncementsWriterOutputSchema = AnnouncementsProductSchema;

export type AnnouncementsDraft = z.infer<typeof AnnouncementsDraftSchema>;
export type AnnouncementsProduct = z.infer<typeof AnnouncementsProductSchema>;

export function buildAnnouncementsWriterPrompt(preparedEvidence: PreparedEvidence): string {
	return `[YOUR ASSIGNMENT]
From the chat messages, file only evidence-grounded milestones and achievements.

[ROLE]
You are filing milestone briefs, not a social column. Treat skill progressions, personal completions, discoveries, territorial claims, technical achievements, and unlocks as possible announcements only when the chat actually supports them. If the chat does not support a milestone worth filing, return an empty announcements array.

[REPORTING]
- Keep each item to an accomplishment or milestone actually evidenced by the chat;
- Do not promote ordinary banter into announcements;
- Quote only exact chat text, character-for-character, inside quotation marks;
- Never invent facts, numbers, names, quotations, outcomes, or significance.

[CHAT MESSAGES]
${fenceUntrustedTranscript(preparedEvidence)}

[OUTPUT]
Return one valid JSON object matching this field contract:
- announcements (array): zero or more noteworthy achievements;
- each announcements item contains exactly:
  - title (string): a brief plain-text achievement headline;
  - summary (string): what was accomplished, with markdown permitted only as defined by the system formatting rules.`;
}

export function parseAnnouncementsWriterOutput(text: string | null): AnnouncementsDraft {
	let candidate: unknown = text;
	if (text !== null) {
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
	}
	const result = AnnouncementsWriterOutputSchema.safeParse(candidate);
	if (!result.success) {
		throw new EditorialOutputContractError(
			"announcements_write",
			"contract_mismatch",
			`announcements_write model output does not match its strict contract: ${result.error.message}`,
		);
	}
	return AnnouncementsProductSchema.parse(
		normalizeDecodedOutputStrings(result.data),
	);
}
