import type { GameReference } from "@bc-news/contracts";
import type { PreparedEvidence } from "./prepared-evidence";

function trustedPromptLine(reference: GameReference): string {
	return reference.kind === "coord"
		? `- ${reference.token}: coord=${reference.northing},${reference.easting}`
		: `- ${reference.token}: entity reference token`;
}

export function formatGameReferencePromptRoster(
	preparedEvidence: PreparedEvidence,
): string {
	if (preparedEvidence.game_references.length === 0) return "";
	const roster = preparedEvidence.game_references.map(trustedPromptLine).join("\n");
	return `
[GAME REFERENCES]
Code identified location references in the chat and assigned exact tokens.
- Whenever you mention one of these references, copy its exact token with no edits and no markdown;
- This applies to every output field, including plain-text titles, headlines, and ledes. Code will resolve tokens appropriately for each field;
- The fenced chat data may include an untrusted token-to-display-name catalog. When you use one of those names, emit the token alone and let code resolve it;
- Do not write both a display name and its token. Emit only the token;
- Do not rewrite a token as raw coordinate syntax, raw entity syntax, or a Markdown link. Code resolves valid tokens to display text in plain fields and to links in rich prose;
${roster}`;
}
