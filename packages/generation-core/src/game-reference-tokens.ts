import {
	CoordinateGameReferenceSchema,
	EntityGameReferenceSchema,
	GameReferenceRosterSchema,
	type CoordinateGameReference,
	type EntityGameReference,
	type GameReference,
	coordGameReferenceDestination,
	entityGameReferenceDestination,
} from "@bc-news/contracts";
import type { PreparedEvidence } from "./prepared-evidence";
import {
	entityReferenceMatches,
	gameReferenceEntityLookupKey,
	type EntityReferenceMatch,
} from "./game-reference-entities";
import type { GameReferenceEntityIdentity } from "./ports";

const COORDINATE_REFERENCE_CANDIDATE_PATTERN =
	/\[([^\]\r\n]+)\]\(coord=(\d+),(\d+)\)|\(coord=(\d+),(\d+)\)/gu;
const GAME_REFERENCE_TOKEN_PATTERN = /\[\[GAME_REF_(\d{3,})\]\]/gu;
const MARKDOWN_WRAPPED_REFERENCE_TOKEN_PATTERN = /(?:\*\*|\*|__|_|~~|`)\[\[GAME_REF_\d{3,}\]\](?:\*\*|\*|__|_|~~|`)|!?\[[^\]\r\n]*\]\(\[\[GAME_REF_\d{3,}\]\]\)/u;
const UNRESOLVED_GAME_REFERENCE_PATTERN = /\[\[[^\]\r\n]*GAME_REF[^\]\r\n]*\]\]|\[\[GAME_REF_[^\r\n]*|\bGAME_REF_\d+\b/iu;
const RAW_COORDINATE_REFERENCE_PATTERN =
	/\[[^\]\r\n]+\]\(coord=\d+,\d+\)|\(coord=\d+,\d+\)/u;
const RAW_ENTITY_REFERENCE_PATTERN = /\((item|cargo|claim|coll|res)=[1-9][0-9]*\)/u;
const BRACKET_LABEL_PREFIX_PATTERN = /\[[^\]\r\n]*\][ \t\r\n]*$/u;
const URLISH_TOKEN_PREFIX_PATTERN = /:\/\/|\]\(|[/?&#=]/u;

export interface GameReferenceLedger {
	readonly entries: readonly GameReference[];
	readonly byMatchKey: ReadonlyMap<string, GameReference>;
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

type ParsedGameReferenceMatch =
	| ({ readonly kind: "coord" } & CoordinateReferenceMatch)
	| ({ readonly kind: "entity" } & EntityReferenceMatch);

function coordDisplayText(northing: number, easting: number): string {
	return `N ${northing}, E ${easting}`;
}

function coordinatePresentationKey(
	northing: number,
	easting: number,
	displayText: string,
): string {
	return `coord:${northing}:${easting}:${displayText}`;
}

function gameReferenceMatchKey(reference: GameReference): string {
	switch (reference.kind) {
		case "coord":
			return coordinatePresentationKey(
				reference.northing,
				reference.easting,
				reference.display_text,
			);
		case "item":
		case "cargo":
		case "claim":
		case "coll":
		case "res":
			return gameReferenceEntityLookupKey(reference);
	}
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

function gameReferenceMatches(value: string): ParsedGameReferenceMatch[] {
	return [
		...coordinateReferenceMatches(value).map((match) => ({ kind: "coord" as const, ...match })),
		...entityReferenceMatches(value).map((match) => ({ kind: "entity" as const, ...match })),
	].sort((left, right) => left.index - right.index || left.length - right.length);
}

function nextGameReferenceToken(ordinal: number): string {
	return `[[GAME_REF_${String(ordinal).padStart(3, "0")}]]`;
}

function buildCoordinateReference(
	ordinal: number,
	match: CoordinateReferenceMatch,
): CoordinateGameReference {
	return CoordinateGameReferenceSchema.parse({
		token: nextGameReferenceToken(ordinal),
		kind: "coord",
		northing: match.northing,
		easting: match.easting,
		display_text: match.displayText,
		destination_url: coordGameReferenceDestination(match.northing, match.easting),
	});
}

function buildEntityReference(
	ordinal: number,
	identity: GameReferenceEntityIdentity,
	displayText: string,
): EntityGameReference {
	return EntityGameReferenceSchema.parse({
		token: nextGameReferenceToken(ordinal),
		kind: identity.kind,
		id: identity.id,
		display_text: displayText,
		destination_url: entityGameReferenceDestination(identity.kind, identity.id),
	});
}

function buildPreparedGameReferencesInternal(
	messages: readonly Pick<{ readonly text: string }, "text">[],
	entityDisplayNames: ReadonlyMap<string, string>,
): GameReference[] {
	const entries: GameReference[] = [];
	const seenCoordinatePresentations = new Set<string>();
	const seenEntityIdentities = new Set<string>();

	for (const message of messages) {
		for (const match of gameReferenceMatches(message.text)) {
			if (match.kind === "coord") {
				const key = coordinatePresentationKey(
					match.northing,
					match.easting,
					match.displayText,
				);
				if (seenCoordinatePresentations.has(key)) {
					continue;
				}
				seenCoordinatePresentations.add(key);
				entries.push(buildCoordinateReference(entries.length + 1, match));
				continue;
			}

			const key = gameReferenceEntityLookupKey(match.identity);
			if (seenEntityIdentities.has(key)) {
				continue;
			}
			seenEntityIdentities.add(key);

			const displayText = entityDisplayNames.get(key);
			if (displayText === undefined) {
				continue;
			}

			entries.push(buildEntityReference(entries.length + 1, match.identity, displayText));
		}
	}

	return entries;
}

export function buildGameReferenceEntityIdentities(
	messages: readonly Pick<{ readonly text: string }, "text">[],
): GameReferenceEntityIdentity[] {
	const identities: GameReferenceEntityIdentity[] = [];
	const seenKeys = new Set<string>();

	for (const message of messages) {
		for (const match of gameReferenceMatches(message.text)) {
			if (match.kind !== "entity") {
				continue;
			}
			const key = gameReferenceEntityLookupKey(match.identity);
			if (seenKeys.has(key)) {
				continue;
			}
			seenKeys.add(key);
			identities.push(match.identity);
		}
	}

	return identities;
}

export function buildPreparedGameReferences(
	messages: readonly Pick<{ readonly text: string }, "text">[],
): GameReference[] {
	return buildPreparedGameReferencesInternal(messages, new Map());
}

export function buildPreparedGameReferencesWithResolvedEntities(
	messages: readonly Pick<{ readonly text: string }, "text">[],
	entityDisplayNames: ReadonlyMap<string, string>,
): GameReference[] {
	return buildPreparedGameReferencesInternal(messages, entityDisplayNames);
}

export function buildGameReferenceLedger(
	preparedEvidence: PreparedEvidence,
): GameReferenceLedger {
	const entries = GameReferenceRosterSchema.parse(preparedEvidence.game_references);
	const byMatchKey = new Map<string, GameReference>();
	const byToken = new Map<string, GameReference>();

	for (const entry of entries) {
		byMatchKey.set(gameReferenceMatchKey(entry), entry);
		byToken.set(entry.token, entry);
	}

	return { entries, byMatchKey, byToken };
}

export function replaceGameReferenceSyntaxWithTokens(
	value: string,
	ledger: GameReferenceLedger,
): string {
	let rewritten = "";
	let nextIndex = 0;

	for (const match of gameReferenceMatches(value)) {
		const replacement =
			match.kind === "coord"
				? ledger.byMatchKey.get(
						coordinatePresentationKey(
							match.northing,
							match.easting,
							match.displayText,
						),
					)?.token
				: ledger.byMatchKey.get(gameReferenceEntityLookupKey(match.identity))?.token ?? "";

		if (match.kind === "coord" && replacement === undefined) {
			const key = coordinatePresentationKey(
				match.northing,
				match.easting,
				match.displayText,
			);
			throw new Error(`Prepared game reference is missing from its ledger: ${key}`);
		}

		rewritten += value.slice(nextIndex, match.index);
		rewritten += replacement ?? value.slice(match.index, match.index + match.length);
		nextIndex = match.index + match.length;
	}

	return `${rewritten}${value.slice(nextIndex)}`;
}

function containsCodeDerivedDisplayText(
	value: string,
	entries: readonly GameReference[],
): boolean {
	return entries.some((entry) => (
		value.includes(entry.display_text) ||
		(entry.kind === "coord" && value.includes(coordDisplayText(entry.northing, entry.easting)))
	));
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
	if (RAW_ENTITY_REFERENCE_PATTERN.test(value)) {
		throw new Error("Raw entity syntax is not allowed in writer output");
	}
	if (containsCodeDerivedDisplayText(value, ledger.entries)) {
		throw new Error("Code-derived game reference display text is not allowed in writer output");
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
