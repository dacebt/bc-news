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

[ELIGIBILITY GATE]
Evaluate every candidate in this order:
1. Exclusion gate: discard it immediately if it is an advertisement, buy or sell order, offer, request, routine work, work in progress, travel or relocation, logistics, advice, or banter. It remains excluded when someone opened, placed, performed, or completed it; when it has large scale or value; when it is intended to help others; and when the chat identifies who did it;
2. Change gate: for a candidate that survives exclusion, require evidence that a specific person, group, or settlement newly reached, finished, discovered, claimed, built, or unlocked a result. An existing capability, remembered experience, explanation, or advice about what can be done fails this gate;
3. Attribution gate: require the evidence to identify the achiever, rather than only the person reporting or discussing the result.
File an item only when it passes all three gates.

[BOUNDARY EXAMPLES]
- Opening a large buy order to help other inhabitants is still an advertisement and is ineligible;
- Reporting a newly rolled legendary or newly reached skill level is eligible when the chat establishes it;
- Moving to another region is logistics, not a territorial achievement, unless the chat establishes a completed claim, settlement, or change of control;
- Explaining an existing crafting capability while answering a question is advice and is ineligible.

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
- Apply the exclusion gate first and remove every excluded activity regardless of completion, scale, value, intent, or attribution;
- From the remaining items, remove anything that does not establish a newly reached result and identify its achiever;
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
