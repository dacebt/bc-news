import { z } from "zod";
import type {
	GameReferenceEntityIdentity,
	GameReferenceEntityResolution,
	GameReferenceResolverPort,
} from "@bc-news/generation-core";
import committedResolutionsJson from "../bitjita/game-reference-resolutions.json";

const ENTITY_KINDS = ["item", "cargo", "claim", "coll", "res"] as const;

export const FixtureGameReferenceResolutionEntrySchema = z.strictObject({
	kind: z.enum(ENTITY_KINDS),
	id: z.string().regex(/^[1-9][0-9]*$/u),
	name: z.string().min(1).refine((value) => value === value.trim(), "Resolution names must be trimmed"),
});

const FixtureGameReferenceResolutionFileSchema = z.array(
	FixtureGameReferenceResolutionEntrySchema,
);

export type FixtureGameReferenceResolutionEntry = z.infer<typeof FixtureGameReferenceResolutionEntrySchema>;

function identityKey(identity: Pick<GameReferenceEntityIdentity, "kind" | "id">): string {
	return `${identity.kind}:${identity.id}`;
}

function resolvedIdentity(
	identity: GameReferenceEntityIdentity,
	name: string,
): GameReferenceEntityResolution {
	return {
		kind: identity.kind,
		id: identity.id,
		outcome: "resolved",
		display_name: name,
	};
}

function unknownIdentity(identity: GameReferenceEntityIdentity): GameReferenceEntityResolution {
	return {
		kind: identity.kind,
		id: identity.id,
		outcome: "unknown",
	};
}

export function parseFixtureGameReferenceResolutionEntries(
	candidate: unknown,
): readonly FixtureGameReferenceResolutionEntry[] {
	const entries = FixtureGameReferenceResolutionFileSchema.parse(candidate);
	const seen = new Set<string>();
	for (const entry of entries) {
		const key = identityKey(entry);
		if (seen.has(key)) {
			throw new Error(`Fixture game reference resolutions repeat canonical identity ${key}`);
		}
		seen.add(key);
	}
	return entries;
}

export function fixtureGameReferenceResolutionEntries(): readonly FixtureGameReferenceResolutionEntry[] {
	return parseFixtureGameReferenceResolutionEntries(committedResolutionsJson);
}

function fixtureResolutionNamesByIdentity(): ReadonlyMap<string, string> {
	return new Map(
		fixtureGameReferenceResolutionEntries().map((entry) => [identityKey(entry), entry.name] as const),
	);
}

export function resolveFixtureGameReferenceIdentities(
	identities: readonly GameReferenceEntityIdentity[],
): readonly GameReferenceEntityResolution[] {
	const entries = fixtureResolutionNamesByIdentity();
	return identities.map((identity) => {
		const name = entries.get(identityKey(identity));
		return name === undefined ? unknownIdentity(identity) : resolvedIdentity(identity, name);
	});
}

export function createFixtureGameReferenceResolver(): GameReferenceResolverPort {
	return {
		resolve(identities) {
			return Promise.resolve(resolveFixtureGameReferenceIdentities(identities));
		},
	};
}

export const fixtureGameReferenceResolver = createFixtureGameReferenceResolver();
