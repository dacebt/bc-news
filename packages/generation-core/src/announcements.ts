import { z } from "zod";
import { AnnouncementSchema } from "@bc-news/contracts";
import { EditorialOutputContractError } from "./main-story";
import { normalizeDecodedOutputStrings } from "./output-normalization";
import type { PreparedEvidence } from "./prepared-evidence";
import { fenceUntrustedTranscript } from "./untrusted-data-fence";
import {
	buildAuthorIdentityLedger,
	resolveAuthorIdentityTokens,
} from "./author-identity-tokens";

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
You are filing milestone briefs, not a social column. An item qualifies only when the chat establishes a completed milestone or achievement, such as a skill progression, personal completion, discovery, territorial achievement, technical achievement, or unlock. Plans, requests, advertisements, offers, routine work, work in progress, logistics, advice, and banter do not qualify. If the chat does not support a milestone worth filing, return an empty announcements array.

[ELIGIBILITY TEST]
File an item only when all three conditions are supported by the chat:
1. The evidence identifies the person, group, or settlement that achieved it, rather than only the person reporting or discussing it;
2. The evidence reports a newly reached result or change, rather than an existing capability, remembered experience, explanation, or advice about what can be done;
3. The result is a milestone or achievement in its own right. An excluded activity does not become a milestone merely because someone completed it: opening or placing an advertisement, order, offer, or request; performing routine work; and sharing logistics or advice remain ineligible.

[REPORTING]
- Keep each item to one completed accomplishment or milestone actually evidenced by the chat;
- Preserve the evidenced status of the accomplishment and do not turn an intention, attempt, or unresolved claim into a completion;
- Attribute chat speakers only with their exact code-owned author tokens. A similar token, person, place, or organization is never an alternate identity;
- Copy every numeric literal character-for-character from the chat. Keep every item, quantity, level, and value paired as they appear together in the source message;
- Quote only exact chat text, character-for-character, inside quotation marks;
- Never invent facts, numbers, names, quotations, outcomes, or significance.

[CHAT MESSAGES]
${fenceUntrustedTranscript(preparedEvidence)}

[FINAL AUDIT]
Before returning, silently audit the announcements against the chat:
- Remove any item whose evidence does not identify the achiever, establish a newly reached result, and qualify as a milestone after the excluded activity types are applied;
- Use exact code-owned author tokens for every named chat speaker and leave their spelling and markdown to code;
- Copy every numeric literal exactly, preserving each complete item-and-value pairing;
- Keep the correspondent's language entirely in-world. When the chat uses out-of-world framing, report the underlying activity in ordinary in-world terms or omit that framing rather than adopting it.

[OUTPUT]
Return one valid JSON object matching this field contract:
- announcements (array): zero or more noteworthy achievements;
- each announcements item contains exactly:
  - title (string): a brief plain-text achievement headline;
  - summary (string): what was accomplished, with markdown permitted only as defined by the system formatting rules.`;
}

export function parseAnnouncementsWriterOutput(
	text: string | null,
	preparedEvidence: PreparedEvidence,
): AnnouncementsDraft {
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
	const normalized = AnnouncementsDraftSchema.parse(
		normalizeDecodedOutputStrings(result.data),
	);
	const authorIdentities = buildAuthorIdentityLedger(preparedEvidence);
	try {
		return AnnouncementsProductSchema.parse({
			announcements: normalized.announcements.map((announcement) => ({
				title: resolveAuthorIdentityTokens(
					announcement.title,
					authorIdentities,
					"plain",
				),
				summary: resolveAuthorIdentityTokens(
					announcement.summary,
					authorIdentities,
					"bold",
				),
			})),
		});
	} catch (cause) {
		throw new EditorialOutputContractError(
			"announcements_write",
			"contract_mismatch",
			"announcements_write model output contains an invalid author identity token",
			{ cause },
		);
	}
}
