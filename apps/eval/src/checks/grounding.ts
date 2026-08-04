import type { MainStoryOutput, PreparedMessage } from "@bc-news/generation-core";
import { checkResult, groundedAuthorNames, mainStoryTextFields, type NamedCheckResult } from "./common";

function normalized(value: string): string {
	return value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
}

function quoteIsGrounded(quote: string, source: string): boolean {
	const cleaned = normalized(quote);
	if (cleaned.length === 0) return false;
	if (source.includes(cleaned)) return true;
	const words = cleaned.split(" ").filter((word) => word.length > 0);
	let longest = 0;
	for (let start = 0; start < words.length; start += 1) {
		for (let end = start + 1; end <= words.length; end += 1) {
			const phrase = words.slice(start, end).join(" ");
			if (source.includes(phrase)) longest = Math.max(longest, phrase.length);
		}
	}
	return longest >= cleaned.length * 0.8;
}

export function groundingCheck(
	output: MainStoryOutput,
	sourceMessages: readonly PreparedMessage[],
): NamedCheckResult<"grounding"> {
	if (sourceMessages.length === 0) {
		return checkResult("grounding", ["No source messages provided"], "Source grounding passed");
	}
	const authors = groundedAuthorNames(sourceMessages);
	const rawSource = sourceMessages.map((message) => message.text).join(" ").toLowerCase();
	const source = normalized(sourceMessages.map((message) => message.text).join(" "));
	const outputText = mainStoryTextFields(output).join(" ");
	const issues: string[] = [];
	for (const match of outputText.matchAll(/\*\*([^*]+)\*\*|(?<!\*)\*([^*]+)\*(?!\*)/g)) {
		const marked = (match[1] ?? match[2] ?? "").trim().toLowerCase();
		const normalizedMarked = normalized(marked);
		const groundedAsAuthor = [...authors].some(
			(author) => marked.includes(author) || author.includes(marked)
		);
		const groundedInSource = normalizedMarked.length > 0 && source.includes(normalizedMarked);
		const grounded = groundedAsAuthor || groundedInSource;
		if (marked.length > 0 && !grounded) issues.push(`Ungrounded marked text: ${marked}`);
	}
	for (const match of outputText.matchAll(/"([^"]{11,})"/g)) {
		const quote = match[1] ?? "";
		if (!quoteIsGrounded(quote, source)) issues.push(`Fabricated quote: ${quote.slice(0, 50)}`);
	}
	for (const match of outputText.matchAll(/\b\d+(?:\.\d+)?%/g)) {
		if (!rawSource.includes(match[0].toLowerCase())) issues.push(`Unverified percentage: ${match[0]}`);
	}
	return checkResult("grounding", issues, "Marked text, quotes, and percentages are grounded");
}
