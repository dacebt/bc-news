import { z } from "zod";
import { AnnouncementSchema } from "@bc-news/contracts";
import { EditorialOutputContractError } from "./main-story";
import type { PreparedEvidence } from "./prepared-evidence";
import { fenceUntrustedTranscript } from "./untrusted-data-fence";

export function buildAnnouncementsPrompt(preparedEvidence: PreparedEvidence): string {
	return `[YOUR ASSIGNMENT]
Region: ${preparedEvidence.active_region_id}
Date: ${preparedEvidence.publication_date}
Messages analyzed: ${preparedEvidence.final_count}

Extract ALL noteworthy achievements and milestones from the chat messages:
- Skill level progressions (fishing, hunting, farming, crafting, building, etc)
- Personal milestones and completions
- Resource discoveries or territorial claims
- Technical achievements or unlocks

Extract ALL noteworthy achievements, not just the most prominent. If multiple players hit milestones, report them all.

Treat skill grinding like economic activity. A player hitting level 50 fishing is as newsworthy as any economic development. No irony, no nudging - just report what was accomplished.

[CRAFTING THE OUTPUT]
Write achievement reports in a straightforward, factual style. Same voice throughout; let the tone of each announcement fit the event. If there are no noteworthy achievements, return an empty announcements array - that's valid.

[CHAT MESSAGES]
${fenceUntrustedTranscript(preparedEvidence)}

[OUTPUT]
Return valid JSON:
{
  "announcements": [
    {
      "title": "Brief achievement headline (plain text, no markdown)",
      "summary": "What was accomplished, include names. Use markdown for **player names** and *emphasis*. Use \\n\\n for paragraph breaks."
    }
  ]
}`;
}

export const AnnouncementsOutputSchema = z.strictObject({
	announcements: z.array(AnnouncementSchema),
});

export type AnnouncementsOutput = z.infer<typeof AnnouncementsOutputSchema>;

/**
 * No fence-stripping, deliberately: v1's silent markdown-fence sanitize was
 * coercion at a boundary. Fenced or otherwise non-JSON model output rejects
 * here; how live providers' fences are handled is a decision the live-provider
 * work must make explicitly, not a fallback this parser applies silently.
 */
export function parseAnnouncementsOutput(text: string): AnnouncementsOutput {
	let candidate: unknown;
	try {
		candidate = JSON.parse(text);
	} catch (cause) {
		throw new EditorialOutputContractError(
			"announcements",
			"invalid_json",
			"announcements model output is not valid JSON",
			{ cause },
		);
	}
	const result = AnnouncementsOutputSchema.safeParse(candidate);
	if (!result.success) {
		throw new EditorialOutputContractError(
			"announcements",
			"contract_mismatch",
			`announcements model output does not match the capability contract: ${result.error.message}`,
		);
	}
	return result.data;
}
