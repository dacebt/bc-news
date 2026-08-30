import { z } from "zod";
import {
	GameReferenceEntityIdSchema,
	GameReferenceEntityKindSchema,
} from "@bc-news/contracts";
import type {
	GameReferenceEntityIdentity,
	GameReferenceEntityResolution,
} from "./ports";

const ENTITY_REFERENCE_CANDIDATE_PATTERN = /\((item|cargo|claim|coll|res)=([1-9][0-9]*)\)/gu;
const URLISH_TOKEN_PREFIX_PATTERN = /:\/\/|\]\(|[/?&#=]/u;

export interface EntityReferenceMatch {
	readonly index: number;
	readonly length: number;
	readonly identity: GameReferenceEntityIdentity;
}

const GameReferenceEntityIdentitySchema = z.strictObject({
	kind: GameReferenceEntityKindSchema,
	id: GameReferenceEntityIdSchema,
});

const GameReferenceEntityResolutionSchema = z.union([
	GameReferenceEntityIdentitySchema.extend({
		outcome: z.literal("resolved"),
		display_name: z.string().min(1),
	}),
	GameReferenceEntityIdentitySchema.extend({
		outcome: z.enum([
			"unknown",
			"unavailable",
			"request_budget_exhausted",
		]),
	}),
]);

function findTokenStart(value: string, index: number): number {
	let tokenStart = index;
	while (tokenStart > 0 && !/\s/u.test(value[tokenStart - 1]!)) {
		tokenStart--;
	}
	return tokenStart;
}

function acceptsEntityReference(value: string, index: number): boolean {
	const tokenPrefix = value.slice(findTokenStart(value, index), index);
	return !URLISH_TOKEN_PREFIX_PATTERN.test(tokenPrefix);
}

export function gameReferenceEntityLookupKey(identity: GameReferenceEntityIdentity): string {
	return `${identity.kind}:${identity.id}`;
}

export function entityReferenceMatches(value: string): EntityReferenceMatch[] {
	const matches: EntityReferenceMatch[] = [];

	for (const match of value.matchAll(ENTITY_REFERENCE_CANDIDATE_PATTERN)) {
		if (match.index === undefined) {
			throw new Error("Game reference match position is unavailable");
		}
		if (!acceptsEntityReference(value, match.index)) {
			continue;
		}
		matches.push({
			index: match.index,
			length: match[0].length,
			identity: GameReferenceEntityIdentitySchema.parse({
				kind: match[1],
				id: match[2],
			}),
		});
	}

	return matches;
}

export function resolveGameReferenceEntityDisplayNames(
	identities: readonly GameReferenceEntityIdentity[],
	outcomes: readonly GameReferenceEntityResolution[],
): ReadonlyMap<string, string> {
	const uniqueIdentities = new Set<string>();
	for (const identity of identities) {
		const parsedIdentity = GameReferenceEntityIdentitySchema.parse(identity);
		const key = gameReferenceEntityLookupKey(parsedIdentity);
		if (uniqueIdentities.has(key)) {
			throw new Error(`Entity resolution plan contains a duplicate identity: ${key}`);
		}
		uniqueIdentities.add(key);
	}

	const parsedOutcomes = z.array(GameReferenceEntityResolutionSchema).parse(outcomes);
	if (parsedOutcomes.length !== identities.length) {
		throw new Error(
			`Entity resolver returned ${String(parsedOutcomes.length)} outcomes for ${String(identities.length)} identities`,
		);
	}

	const displayNames = new Map<string, string>();
	const seenOutcomeKeys = new Set<string>();

	for (const [index, outcome] of parsedOutcomes.entries()) {
		const identity = GameReferenceEntityIdentitySchema.parse(identities[index]);
		if (outcome.kind !== identity.kind || outcome.id !== identity.id) {
			throw new Error(
				`Entity resolver returned an out-of-order or mismatched identity at index ${String(index)}`,
			);
		}

		const key = gameReferenceEntityLookupKey(identity);
		if (seenOutcomeKeys.has(key)) {
			throw new Error(`Entity resolver returned a duplicate identity outcome: ${key}`);
		}
		seenOutcomeKeys.add(key);

		if (outcome.outcome === "resolved") {
			displayNames.set(key, outcome.display_name);
		}
	}

	return displayNames;
}
