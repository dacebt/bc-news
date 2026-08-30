import { z } from "zod";
import type { GameReferenceEntityIdentity } from "@bc-news/generation-core";

const BitJitaResolutionKindSchema = z.enum(["item", "cargo", "claim", "coll", "res"]);
const CanonicalDigitStringSchema = z.string().regex(/^(0|[1-9]\d*)$/);
const NonBlankStringSchema = z.string().refine((value) => value.trim().length > 0, {
	message: "Expected a nonblank string",
});

export type BitJitaResolutionKind = z.infer<typeof BitJitaResolutionKindSchema>;
export type BitJitaEntityIdentity = {
	readonly kind: BitJitaResolutionKind;
	readonly id: string;
};

type BitJitaGameReferenceDeterministicErrorCode =
	| "bitjita_game_reference_invalid_base_url"
	| "bitjita_game_reference_invalid_identity_kind"
	| "bitjita_game_reference_invalid_identity_id"
	| "bitjita_game_reference_unsafe_numeric_id"
	| "bitjita_game_reference_invalid_json"
	| "bitjita_game_reference_response_invalid"
	| "bitjita_game_reference_invalid_name"
	| "bitjita_game_reference_id_mismatch"
	| "bitjita_game_reference_http_status_invalid";

export class BitJitaGameReferenceDeterministicError extends Error {
	readonly code: BitJitaGameReferenceDeterministicErrorCode;

	constructor(code: BitJitaGameReferenceDeterministicErrorCode, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "BitJitaGameReferenceDeterministicError";
		this.code = code;
	}
}

const EnvelopeSchemas = {
	item: z.object({
		item: z.object({
			id: z.union([CanonicalDigitStringSchema, z.number()]),
			name: z.string(),
		}),
	}),
	cargo: z.object({
		cargo: z.object({
			id: z.union([CanonicalDigitStringSchema, z.number()]),
			name: z.string(),
		}),
	}),
	claim: z.object({
		claim: z.object({
			entityId: z.union([CanonicalDigitStringSchema, z.number()]),
			name: z.string(),
		}),
	}),
	coll: z.object({
		collectible: z.object({
			id: z.union([CanonicalDigitStringSchema, z.number()]),
			name: z.string(),
		}),
	}),
	res: z.object({
		resource: z.object({
			id: z.union([CanonicalDigitStringSchema, z.number()]),
			name: z.string(),
		}),
	}),
} as const;

export const BitJitaRouteByKind: Record<BitJitaResolutionKind, { readonly apiPath: string }> = {
	item: { apiPath: "api/items" },
	cargo: { apiPath: "api/cargo" },
	claim: { apiPath: "api/claims" },
	coll: { apiPath: "api/collectibles" },
	res: { apiPath: "api/resources" },
};

export function normalizeBitJitaBaseUrl(baseUrl: string): URL {
	let parsed: URL;
	try {
		parsed = new URL(baseUrl);
	} catch (error) {
		throw new BitJitaGameReferenceDeterministicError(
			"bitjita_game_reference_invalid_base_url",
			"BITJITA_API_BASE must be a valid absolute HTTP(S) URL",
			{ cause: error },
		);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new BitJitaGameReferenceDeterministicError(
			"bitjita_game_reference_invalid_base_url",
			"BITJITA_API_BASE must be a valid absolute HTTP(S) URL",
		);
	}
	if (parsed.username !== "" || parsed.password !== "") {
		throw new BitJitaGameReferenceDeterministicError(
			"bitjita_game_reference_invalid_base_url",
			"BITJITA_API_BASE must not include credentials",
		);
	}
	if (!parsed.pathname.endsWith("/")) {
		parsed.pathname = `${parsed.pathname}/`;
	}
	return parsed;
}

export function normalizeBitJitaIdentity(identity: GameReferenceEntityIdentity): BitJitaEntityIdentity {
	return {
		kind: toBitJitaKind(identity.kind),
		id: normalizeEntityId(identity.id),
	};
}

export function parseBitJitaEntityPayload(
	kind: BitJitaResolutionKind,
	payload: unknown,
): { readonly responseId: string; readonly displayName: string } {
	switch (kind) {
		case "item": {
			const result = EnvelopeSchemas.item.safeParse(payload);
			if (!result.success) {
				throw invalidEnvelopeError(kind, result.error);
			}
			return {
				responseId: normalizeEntityId(result.data.item.id),
				displayName: validateDisplayName(result.data.item.name),
			};
		}
		case "cargo": {
			const result = EnvelopeSchemas.cargo.safeParse(payload);
			if (!result.success) {
				throw invalidEnvelopeError(kind, result.error);
			}
			return {
				responseId: normalizeEntityId(result.data.cargo.id),
				displayName: validateDisplayName(result.data.cargo.name),
			};
		}
		case "claim": {
			const result = EnvelopeSchemas.claim.safeParse(payload);
			if (!result.success) {
				throw invalidEnvelopeError(kind, result.error);
			}
			return {
				responseId: normalizeEntityId(result.data.claim.entityId),
				displayName: validateDisplayName(result.data.claim.name),
			};
		}
		case "coll": {
			const result = EnvelopeSchemas.coll.safeParse(payload);
			if (!result.success) {
				throw invalidEnvelopeError(kind, result.error);
			}
			return {
				responseId: normalizeEntityId(result.data.collectible.id),
				displayName: validateDisplayName(result.data.collectible.name),
			};
		}
		case "res": {
			const result = EnvelopeSchemas.res.safeParse(payload);
			if (!result.success) {
				throw invalidEnvelopeError(kind, result.error);
			}
			return {
				responseId: normalizeEntityId(result.data.resource.id),
				displayName: validateDisplayName(result.data.resource.name),
			};
		}
	}
}

function toBitJitaKind(kind: GameReferenceEntityIdentity["kind"]): BitJitaResolutionKind {
	const result = BitJitaResolutionKindSchema.safeParse(kind);
	if (!result.success) {
		throw new BitJitaGameReferenceDeterministicError(
			"bitjita_game_reference_invalid_identity_kind",
			"Game reference resolver received an unsupported BitJita entity kind",
		);
	}
	return result.data;
}

function normalizeEntityId(id: unknown): string {
	if (typeof id === "string") {
		if (!CanonicalDigitStringSchema.safeParse(id).success) {
			throw new BitJitaGameReferenceDeterministicError(
				"bitjita_game_reference_invalid_identity_id",
				"BitJita entity ids must be canonical decimal strings or safe integers",
			);
		}
		return id;
	}
	if (typeof id === "number") {
		if (!Number.isSafeInteger(id) || id < 0) {
			throw new BitJitaGameReferenceDeterministicError(
				"bitjita_game_reference_unsafe_numeric_id",
				"BitJita entity ids must be canonical decimal strings or safe integers",
			);
		}
		return String(id);
	}
	throw new BitJitaGameReferenceDeterministicError(
		"bitjita_game_reference_invalid_identity_id",
		"BitJita entity ids must be canonical decimal strings or safe integers",
	);
}

function validateDisplayName(name: unknown): string {
	const result = NonBlankStringSchema.safeParse(name);
	if (!result.success) {
		throw new BitJitaGameReferenceDeterministicError(
			"bitjita_game_reference_invalid_name",
			"BitJita entity lookup returned an invalid display name",
			{ cause: result.error },
		);
	}
	return result.data;
}

function invalidEnvelopeError(
	kind: BitJitaResolutionKind,
	cause: z.ZodError,
): BitJitaGameReferenceDeterministicError {
	return new BitJitaGameReferenceDeterministicError(
		"bitjita_game_reference_response_invalid",
		`BitJita ${kind} lookup returned an invalid response envelope`,
		{ cause },
	);
}
