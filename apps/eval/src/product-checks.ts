import type {
	AnnouncementsProduct,
	MainStoryProduct,
	PreparedEvidence,
} from "@bc-news/generation-core";

const FORBIDDEN_PATTERNS = [
	/ignore\s+previous\s+instructions/i,
	/system\s+prompt/i,
	/developer\s+message/i,
	/as\s+(?:an?\s+)?AI\b/i,
	/```/,
	/^#{1,6}\s/m,
	/—/,
];

function normalized(value: string): string {
	return value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
}

function allEditorialText(mainStory: MainStoryProduct, announcements: AnnouncementsProduct): string[] {
	return [
		mainStory.title,
		mainStory.subtitle,
		mainStory.main_story.headline,
		mainStory.main_story.lede,
		mainStory.main_story.body,
		...announcements.announcements.flatMap((announcement) => [announcement.title, announcement.summary]),
	];
}

/** Deterministic final-product checks only; this is not a semantic quality score. */
export function assertFinalProductChecks(
	mainStory: MainStoryProduct,
	announcements: AnnouncementsProduct,
	preparedEvidence: PreparedEvidence,
): void {
	const failures: string[] = [];
	const editorialText = allEditorialText(mainStory, announcements).join("\n");
	for (const pattern of FORBIDDEN_PATTERNS) {
		const match = pattern.exec(editorialText);
		if (match !== null) failures.push(`forbidden output marker: ${match[0]}`);
	}

	const source = normalized(
		preparedEvidence.messages.map((message) => `${message.author_name} ${message.text}`).join(" "),
	);
	const groundedText = [
		mainStory.main_story.headline,
		mainStory.main_story.lede,
		mainStory.main_story.body,
		...announcements.announcements.flatMap((announcement) => [announcement.title, announcement.summary]),
	].join(" ");
	for (const match of groundedText.matchAll(/\*\*([^*]+)\*\*/g)) {
		const marked = normalized(match[1] ?? "");
		if (marked !== "" && !source.includes(marked)) failures.push(`ungrounded marked name: ${match[1]}`);
	}
	for (const match of groundedText.matchAll(/["“]([^"”]{2,})["”]/g)) {
		const quote = normalized(match[1] ?? "");
		if (quote !== "" && !source.includes(quote)) failures.push(`ungrounded quote: ${match[1]}`);
	}
	if (failures.length > 0) {
		throw new Error(`final editorial products failed deterministic checks: ${failures.join("; ")}`);
	}
}
