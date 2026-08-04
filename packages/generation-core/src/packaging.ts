import { z } from "zod";
import { EditionSchema } from "@bc-news/contracts";
import type { AnnouncementsOutput } from "./announcements";
import { EditorialOutputContractError, type MainStoryOutput } from "./main-story";
import { fenceUntrustedJson } from "./untrusted-data-fence";

/**
 * v1's stage 3 round-tripped the whole edition through the model with
 * preservation unenforced -- deliberately rejected here. Packaging receives
 * only the announcements and main story outputs (no chat transcript) and
 * authors ONLY title and subtitle; every other edition field is composed
 * deterministically in code, so there is nothing left to preserve or drift.
 *
 * Region and publication date are supplied as plain context lines, the same
 * way v1's buildStage3Prompt supplied them and the same way this package's
 * other prompt builders supply them from PreparedEvidence: without them the
 * model has no way to identify which of the active regions it is writing a
 * masthead for, and no grounded date to write a subtitle from -- it can only
 * invent or copy an example. Both values are validated digits-only /
 * format-pinned before they ever reach this builder, so interpolating them
 * directly needs no additional escaping.
 */
export function buildPackagingPrompt(
	mainStory: MainStoryOutput,
	announcements: AnnouncementsOutput,
	context: { activeRegionId: string; publicationDate: string },
): string {
	return `[YOUR ASSIGNMENT]
Region: ${context.activeRegionId}
Date: ${context.publicationDate}

You are given the day's announcements and main story, already filed. Package the edition for publication:

- Write an edition title (regional masthead for the Region above, e.g. "The Eastern Gazette", "The Frontier Bulletin")
- Write an edition subtitle (the Date above, formatted as a full date, e.g. "Month D, YYYY", or brief context like "Daily Regional Dispatch")

Base the title and subtitle on the Region, the Date, and the tone and content of the announcements and main story below - do not invent details beyond formatting the Region and Date you were given. Do NOT edit, shorten, rewrite, or repeat their content: your output is title and subtitle only.

[ANNOUNCEMENTS]
${fenceUntrustedJson("ANNOUNCEMENTS", announcements)}

[MAIN STORY]
${fenceUntrustedJson("MAIN STORY", mainStory)}

[OUTPUT]
Return valid JSON:
{
  "title": "Edition masthead title",
  "subtitle": "Edition subtitle or context"
}`;
}

/**
 * Derived from EditionSchema, not hand-rolled: title and subtitle are edition
 * contract fields, so packaging's output contract is a projection of the one
 * definition in @bc-news/contracts, the same way MainStoryOutputSchema and
 * AnnouncementsOutputSchema derive from the contracts package rather than
 * re-declaring their fields.
 */
export const PackagingOutputSchema = EditionSchema.pick({ title: true, subtitle: true });

export type PackagingOutput = z.infer<typeof PackagingOutputSchema>;

/**
 * No fence-stripping, deliberately: v1's silent markdown-fence sanitize was
 * coercion at a boundary. Fenced or otherwise non-JSON model output rejects
 * here; how live providers' fences are handled is a decision the live-provider
 * work must make explicitly, not a fallback this parser applies silently.
 */
export function parsePackagingOutput(text: string): PackagingOutput {
	let candidate: unknown;
	try {
		candidate = JSON.parse(text);
	} catch (cause) {
		throw new EditorialOutputContractError(
			"packaging",
			"invalid_json",
			"packaging model output is not valid JSON",
			{ cause },
		);
	}
	const result = PackagingOutputSchema.safeParse(candidate);
	if (!result.success) {
		throw new EditorialOutputContractError(
			"packaging",
			"contract_mismatch",
			`packaging model output does not match the capability contract: ${result.error.message}`,
		);
	}
	return result.data;
}
