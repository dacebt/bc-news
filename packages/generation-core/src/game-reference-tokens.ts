import {
	GameReferenceRosterSchema,
	GameReferenceSchema,
	type GameReference,
	coordGameReferenceDestination,
} from "@bc-news/contracts";
import type { PreparedEvidence } from "./prepared-evidence";

const COORDINATE_REFERENCE_CANDIDATE_PATTERN =
	/\[([^\]\r\n]+)\]\(coord=(\d+),(\d+)\)|\(coord=(\d+),(\d+)\)/gu;
const GAME_REFERENCE_TOKEN_PATTERN = /\[\[GAME_REF_(\d{3,})\]\]/gu;
const MARKDOWN_WRAPPED_REFERENCE_TOKEN_PATTERN = /(?:\*\*|\*|__|_|~~|`)\[\[GAME_REF_\d{3,}\]\](?:\*\*|\*|__|_|~~|`)|!?\[[^\]\r\n]*\]\(\[\[GAME_REF_\d{3,}\]\]\)/u;
const UNRESOLVED_GAME_REFERENCE_PATTERN = /\[\[[^\]\r\n]*GAME_REF[^\]\r\n]*\]\]|\[\[GAME_REF_[^\r\n]*|\bGAME_REF_\d+\b/iu;
const RAW_COORDINATE_REFERENCE_PATTERN =
	/\[[^\]\r\n]+\]\(coord=\d+,\d+\)|\(coord=\d+,\d+\)/u;
const BRACKET_LABEL_PREFIX_PATTERN = /\[[^\]\r\n]*\][ \t\r\n]*$/u;
const URLISH_TOKEN_PREFIX_PATTERN = /:\/\/|\]\(|[/?&#=]/u;

export interface GameReferenceLedger {
	readonly entries: readonly GameReference[];
	readonly byPresentation: ReadonlyMap<string, GameReference>;
	readonly byToken: ReadonlyMap<string, GameReference>;
}

export type GameReferenceRendering = "plain" | "rich";

interface CoordinateReferenceMatch {
	readonly index: number;
	readonly length: number;
	readonly northing: number;
	readonly easting: number;
	readonly displayText: string;
}

function coordDisplayText(northing: number, easting: number): string {
	return `N ${northing}, E ${easting}`;
}

function presentationKey(
	northing: number,
	easting: number,
	displayText: string,
): string {
	return `coord:${northing}:${easting}:${displayText}`;
}

function findTokenStart(value: string, index: number): number {
	let tokenStart = index;
	while (tokenStart > 0 && !/\s/u.test(value[tokenStart - 1]!)) {
		tokenStart--;
	}
	return tokenStart;
}

function acceptsBareCoordinateReference(value: string, index: number): boolean {
	if (BRACKET_LABEL_PREFIX_PATTERN.test(value.slice(0, index))) {
		return false;
	}
	const tokenPrefix = value.slice(findTokenStart(value, index), index);
	return !URLISH_TOKEN_PREFIX_PATTERN.test(tokenPrefix);
}

function coordinateReferenceMatches(value: string): CoordinateReferenceMatch[] {
	const matches: CoordinateReferenceMatch[] = [];

	for (const match of value.matchAll(COORDINATE_REFERENCE_CANDIDATE_PATTERN)) {
		if (match.index === undefined) {
			throw new Error("Game reference match position is unavailable");
		}

		const label = match[1];
		if (label === undefined && !acceptsBareCoordinateReference(value, match.index)) {
			continue;
		}

		const northing = Number.parseInt((label === undefined ? match[4] : match[2])!, 10);
		const easting = Number.parseInt((label === undefined ? match[5] : match[3])!, 10);
		matches.push({
			index: match.index,
			length: match[0].length,
			northing,
			easting,
			displayText: label ?? coordDisplayText(northing, easting),
		});
	}

	return matches;
}

export function buildPreparedGameReferences(
	messages: readonly Pick<{ readonly text: string }, "text">[],
): GameReference[] {
	const entries: GameReference[] = [];
	const byPresentation = new Map<string, GameReference>();

	for (const message of messages) {
		for (const match of coordinateReferenceMatches(message.text)) {
			const { northing, easting, displayText } = match;
			const key = presentationKey(northing, easting, displayText);
			if (byPresentation.has(key)) continue;

			const entry = GameReferenceSchema.parse({
				token: `[[GAME_REF_${String(entries.length + 1).padStart(3, "0")}]]`,
				kind: "coord",
				northing,
				easting,
				display_text: displayText,
				destination_url: coordGameReferenceDestination(northing, easting),
			});
			entries.push(entry);
			byPresentation.set(key, entry);
		}
	}

	return entries;
}

export function buildGameReferenceLedger(
	preparedEvidence: PreparedEvidence,
): GameReferenceLedger {
	const entries = GameReferenceRosterSchema.parse(preparedEvidence.game_references);
	const byPresentation = new Map<string, GameReference>();
	const byToken = new Map<string, GameReference>();

	for (const entry of entries) {
		byPresentation.set(
			presentationKey(entry.northing, entry.easting, entry.display_text),
			entry,
		);
		byToken.set(entry.token, entry);
	}

	return { entries, byPresentation, byToken };
}

export function replaceGameReferenceSyntaxWithTokens(
	value: string,
	ledger: GameReferenceLedger,
): string {
	let rewritten = "";
	let nextIndex = 0;

	for (const match of coordinateReferenceMatches(value)) {
		const key = presentationKey(
			match.northing,
			match.easting,
			match.displayText,
		);
		const entry = ledger.byPresentation.get(key);
		if (entry === undefined) {
			throw new Error(`Prepared game reference is missing from its ledger: ${key}`);
		}
		rewritten += value.slice(nextIndex, match.index);
		rewritten += entry.token;
		nextIndex = match.index + match.length;
	}

	return `${rewritten}${value.slice(nextIndex)}`;
}

export function formatGameReferencePromptRoster(
	preparedEvidence: PreparedEvidence,
): string {
	if (preparedEvidence.game_references.length === 0) return "";
	const roster = preparedEvidence.game_references
		.map((reference) => `- ${reference.token}: coord=${reference.northing},${reference.easting}`)
		.join("\n");
	return `
[GAME REFERENCES]
Code identified location references in the chat and assigned exact tokens.
- Whenever you mention one of these locations, copy its exact token with no edits and no markdown;
- This applies to every output field, including plain-text titles, headlines, and ledes. Code will resolve tokens appropriately for each field;
- Do not rewrite a token as raw coordinate syntax or as a Markdown link. Code resolves valid tokens to display text in plain fields and to links in rich prose;
${roster}`;
}

export function transformGameReferenceTokens(
	value: string,
	ledger: GameReferenceLedger,
	rendering: GameReferenceRendering,
): string {
	if (MARKDOWN_WRAPPED_REFERENCE_TOKEN_PATTERN.test(value)) {
		throw new Error("Game reference tokens may not be markdown-wrapped");
	}
	if (RAW_COORDINATE_REFERENCE_PATTERN.test(value)) {
		throw new Error("Raw coordinate syntax is not allowed in writer output");
	}
	if (ledger.entries.some((entry) => value.includes(coordDisplayText(entry.northing, entry.easting)))) {
		throw new Error("Code-derived coordinate display text is not allowed in writer output");
	}

	const resolved = value.replace(GAME_REFERENCE_TOKEN_PATTERN, (token) => {
		const entry = ledger.byToken.get(token);
		if (entry === undefined) {
			throw new Error(`Unknown game reference token: ${token}`);
		}
		return rendering === "plain" ? entry.display_text : token;
	});
	const strippedKnownTokens = value.replace(GAME_REFERENCE_TOKEN_PATTERN, (token) => {
		if (!ledger.byToken.has(token)) {
			throw new Error(`Unknown game reference token: ${token}`);
		}
		return "";
	});
	if (UNRESOLVED_GAME_REFERENCE_PATTERN.test(strippedKnownTokens)) {
		throw new Error("Malformed or unresolved game reference token");
	}
	return resolved;
}

export function hasPreparedGameReferences(
	preparedEvidence: PreparedEvidence,
): boolean {
	return preparedEvidence.game_references.length > 0;
}
