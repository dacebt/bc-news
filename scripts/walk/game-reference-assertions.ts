import type { Edition } from "@bc-news/contracts";

type ExpectedGameReference =
	| {
		readonly token: string;
		readonly kind: "coord";
		readonly northing: number;
		readonly easting: number;
		readonly display_text: string;
		readonly destination_url: string;
	}
	| {
		readonly token: string;
		readonly kind: "item";
		readonly id: string;
		readonly display_text: string;
		readonly destination_url: string;
	};

export const FOCUSED_MAP_DESTINATION = "https://bitcraftmap.com/?center=7968,9659&zoom=3.0";
export const SPOOFED_FOCUSED_MAP_DESTINATION = "https://bitcraftmap.com/?center=1,1&zoom=99";
export const TRUSTED_ITEM_DESTINATION = "https://bitjita.com/items/163977632";

export const EXPECTED_GAME_REFERENCES: readonly ExpectedGameReference[] = [
	{
		token: "[[GAME_REF_001]]",
		kind: "item",
		id: "163977632",
		display_text: "Ornate Leather Shirt",
		destination_url: TRUSTED_ITEM_DESTINATION,
	},
	{
		token: "[[GAME_REF_002]]",
		kind: "coord",
		northing: 7968,
		easting: 9659,
		display_text: "Fire Nation",
		destination_url: FOCUSED_MAP_DESTINATION,
	},
	{
		token: "[[GAME_REF_003]]",
		kind: "coord",
		northing: 7968,
		easting: 9659,
		display_text: "N 7968, E 9659",
		destination_url: FOCUSED_MAP_DESTINATION,
	},
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertPublishedGameReferences(edition: unknown): void {
	if (!isRecord(edition) || !Array.isArray(edition.game_references)) {
		throw new Error("published edition is missing the exact game-reference roster");
	}
	if (JSON.stringify(edition.game_references) !== JSON.stringify(EXPECTED_GAME_REFERENCES)) {
		throw new Error(`published edition retained an unexpected game-reference roster: ${JSON.stringify(edition.game_references)}`);
	}
}

function countTokenOccurrences(text: string, token: string): number {
	return text.split(token).length - 1;
}

export function renderedGameReferenceOccurrences(edition: Edition, token: string): number {
	return countTokenOccurrences(edition.main_story.body, token)
		+ edition.announcements.reduce(
			(total, announcement) => total + countTokenOccurrences(announcement.summary, token),
			0,
		);
}

export function renderedMarkdownText(value: string, edition: unknown): string {
	if (!isRecord(edition) || !Array.isArray(edition.game_references)) {
		throw new Error("published edition is missing game references needed to render expected text");
	}
	let normalized = value;
	for (const reference of edition.game_references) {
		if (!isRecord(reference) || typeof reference.token !== "string" || typeof reference.display_text !== "string") {
			throw new Error("published edition has an invalid game-reference roster");
		}
		normalized = normalized.replaceAll(reference.token, reference.display_text);
	}
	return normalized.replaceAll("**", "").replace(/\[([^\]]+)\]\(([^)]+)\)/gu, "$1");
}
