import type { V1AnnouncementsProduct, V1MainStoryProduct, V1PreparedEvidence } from "./evaluation-artifact-v1-contracts";

const FORBIDDEN_PATTERNS = [/ignore\s+previous\s+instructions/i, /system\s+prompt/i, /developer\s+message/i, /as\s+(?:an?\s+)?AI\b/i, /```/, /^#{1,6}\s/m, /—/];

function normalized(value: string): string {
	return value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
}

function failures(editorialText: readonly string[], groundedText: string, evidence: V1PreparedEvidence): string[] {
	const result: string[] = [];
	const joined = editorialText.join("\n");
	for (const pattern of FORBIDDEN_PATTERNS) {
		const match = pattern.exec(joined);
		if (match !== null) result.push(`forbidden output marker: ${match[0]}`);
	}
	const source = normalized(evidence.messages.map((message) => `${message.author_name} ${message.text}`).join(" "));
	for (const match of groundedText.matchAll(/\*\*([^*]+)\*\*/g)) {
		const marked = normalized(match[1] ?? "");
		if (marked !== "" && !source.includes(marked)) result.push(`ungrounded marked name: ${match[1]}`);
	}
	for (const match of groundedText.matchAll(/["“]([^"”]{2,})["”]/g)) {
		const quote = normalized(match[1] ?? "");
		if (quote !== "" && !source.includes(quote)) result.push(`ungrounded quote: ${match[1]}`);
	}
	return result;
}

export function findV1MainStoryFinalProductFailures(product: V1MainStoryProduct, evidence: V1PreparedEvidence): string[] {
	return failures([product.title, product.subtitle, product.main_story.headline, product.main_story.lede, product.main_story.body], [product.main_story.headline, product.main_story.lede, product.main_story.body].join(" "), evidence);
}

export function findV1AnnouncementsFinalProductFailures(product: V1AnnouncementsProduct, evidence: V1PreparedEvidence): string[] {
	const text = product.announcements.flatMap((announcement) => [announcement.title, announcement.summary]);
	return failures(text, text.join(" "), evidence);
}
