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

function mainStoryText(mainStory: MainStoryProduct): string[] {
	return [
		mainStory.title,
		mainStory.subtitle,
		mainStory.main_story.headline,
		mainStory.main_story.lede,
		mainStory.main_story.body,
	];
}

function announcementsText(announcements: AnnouncementsProduct): string[] {
	return announcements.announcements.flatMap((announcement) => [announcement.title, announcement.summary]);
}

function finalProductFailures(editorialText: readonly string[], groundedText: string, preparedEvidence: PreparedEvidence): string[] {
	const failures: string[] = [];
	const joinedEditorialText = editorialText.join("\n");
	for (const pattern of FORBIDDEN_PATTERNS) {
		const match = pattern.exec(joinedEditorialText);
		if (match !== null) failures.push(`forbidden output marker: ${match[0]}`);
	}

	const source = normalized(
		preparedEvidence.messages.map((message) => `${message.author_name} ${message.text}`).join(" "),
	);
	for (const match of groundedText.matchAll(/\*\*([^*]+)\*\*/g)) {
		const marked = normalized(match[1] ?? "");
		if (marked !== "" && !source.includes(marked)) failures.push(`ungrounded marked name: ${match[1]}`);
	}
	for (const match of groundedText.matchAll(/["“]([^"”]{2,})["”]/g)) {
		const quote = normalized(match[1] ?? "");
		if (quote !== "" && !source.includes(quote)) failures.push(`ungrounded quote: ${match[1]}`);
	}
	return failures;
}

/** Independently callable deterministic findings for the final main-story product. */
export function findMainStoryFinalProductFailures(
	mainStory: MainStoryProduct,
	preparedEvidence: PreparedEvidence,
): string[] {
	return finalProductFailures(
		mainStoryText(mainStory),
		[mainStory.main_story.headline, mainStory.main_story.lede, mainStory.main_story.body].join(" "),
		preparedEvidence,
	);
}

/** Independently callable deterministic findings for the final announcements product. */
export function findAnnouncementsFinalProductFailures(
	announcements: AnnouncementsProduct,
	preparedEvidence: PreparedEvidence,
): string[] {
	return finalProductFailures(
		announcementsText(announcements),
		announcements.announcements.flatMap((announcement) => [announcement.title, announcement.summary]).join(" "),
		preparedEvidence,
	);
}

/** Deterministic final-product checks only; this is not a semantic quality score. */
export function assertFinalProductChecks(
	mainStory: MainStoryProduct,
	announcements: AnnouncementsProduct,
	preparedEvidence: PreparedEvidence,
): void {
	const failures = [
		...findMainStoryFinalProductFailures(mainStory, preparedEvidence),
		...findAnnouncementsFinalProductFailures(announcements, preparedEvidence),
	];
	if (failures.length > 0) {
		throw new Error(`final editorial products failed deterministic checks: ${failures.join("; ")}`);
	}
}
