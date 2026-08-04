import type { MainStoryOutput, PreparedMessage } from "@bc-news/generation-core";
import { checkResult, knownPlayerNames, mainStoryTextFields, type NamedCheckResult } from "./common";

const MINIMUM_STORY_LENGTH = 1200;
const GAME_TERMS = new Set([
	"fishing", "mining", "hunting", "crafting", "building", "scholar",
	"forestry", "combat", "farming",
]);
const META_PATTERNS = [
	/\*Angle:\*/i,
	/\*Note:\*/i,
	/\*Context:\*/i,
	/\*Strategy:\*/i,
	/\*Summary:\*/i,
	/\bthis story\b/i,
	/\bthe narrative\b/i,
	/\bthe angle\b/i,
	/\bthis article\b/i,
	/\bthe story focuses on\b/i,
	/\bthis piece\b/i,
];
const EMOJI_PATTERN = /[\u{1F1E0}-\u{1F9FF}\u{2702}-\u{27B0}]/u;

function checkBoldFormatting(
	body: string,
	sourceMessages: readonly PreparedMessage[],
	issues: string[],
): void {
	const knownPlayers = knownPlayerNames(sourceMessages);
	const bold = [...body.matchAll(/\*\*([^*]+)\*\*/g)].map((match) => match[1] ?? "");
	if (bold.length === 0) issues.push("No bolded player names found");
	for (const value of bold) {
		const normalized = value.toLowerCase().trim();
		if (/^\d+$/.test(value)) issues.push(`Bold used on number: ${value}`);
		else if (/^(level|lvl)\s*\d+$/.test(normalized)) issues.push(`Bold used on level: ${value}`);
		else if (!knownPlayers.has(normalized) && GAME_TERMS.has(normalized)) {
			issues.push(`Bold used on game term: ${value}`);
		}
	}
	for (const match of body.matchAll(/(?<!\*)\*([^*]+)\*(?!\*)/g)) {
		const value = (match[1] ?? "").toLowerCase().trim();
		if (knownPlayers.has(value)) issues.push(`Player name is italic instead of bold: ${value}`);
	}
}

/**
 * Enforces SYSTEM_CONSTRAINTS from generation-core's main-story prompt: bold
 * reserved for player names, italics for game terms/emphasis, no em dashes,
 * no markdown headers or code blocks, \n\n paragraph breaks.
 */
export function formattingCheck(
	output: MainStoryOutput,
	sourceMessages: readonly PreparedMessage[],
): NamedCheckResult<"formatting"> {
	const allText = mainStoryTextFields(output).join("\n");
	const body = output.main_story.body;
	const issues: string[] = [];
	if (body.length < MINIMUM_STORY_LENGTH) {
		issues.push(`Body too short: ${body.length} chars (min ${MINIMUM_STORY_LENGTH})`);
	}
	if (!body.includes("\n\n")) issues.push("No paragraph breaks found in body");
	if (body.includes("\\n")) issues.push("Body contains literal newline escapes");
	checkBoldFormatting(body, sourceMessages, issues);
	if (/^#{1,6}\s/m.test(body)) issues.push("Contains markdown headers");
	if (body.includes("```")) issues.push("Contains code blocks");
	for (const pattern of META_PATTERNS) {
		const match = pattern.exec(body);
		if (match !== null) {
			issues.push(`Meta-commentary detected: ${match[0]}`);
			break;
		}
	}
	if (allText.includes("—")) issues.push("Contains an em dash");
	if (EMOJI_PATTERN.test(allText)) issues.push("Contains emoji");
	return checkResult("formatting", issues, `Formatting passed with body length ${body.length}`);
}
