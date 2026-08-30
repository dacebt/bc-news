import type {
	GameReferenceEntityResolution,
	GameReferenceResolverPort,
} from "@bc-news/generation-core";
import {
	BitJitaGameReferenceDeterministicError,
	type BitJitaEntityIdentity,
	BitJitaRouteByKind,
	normalizeBitJitaBaseUrl,
	normalizeBitJitaIdentity,
	parseBitJitaEntityPayload,
} from "./bitjita-game-reference-resolver-support";

const BITJITA_REQUEST_TIMEOUT_MS = 10_000;
const BITJITA_RESOLVE_REQUEST_BUDGET = 18;
export { BitJitaGameReferenceDeterministicError };

function unavailableResolution(
	identity: BitJitaEntityIdentity,
): GameReferenceEntityResolution {
	return { kind: identity.kind, id: identity.id, outcome: "unavailable" };
}

function unknownResolution(
	identity: BitJitaEntityIdentity,
): GameReferenceEntityResolution {
	return { kind: identity.kind, id: identity.id, outcome: "unknown" };
}

function requestBudgetExhaustedResolution(
	identity: BitJitaEntityIdentity,
): GameReferenceEntityResolution {
	return { kind: identity.kind, id: identity.id, outcome: "request_budget_exhausted" };
}

function resolvedResolution(
	identity: BitJitaEntityIdentity,
	displayName: string,
): GameReferenceEntityResolution {
	return {
		kind: identity.kind,
		id: identity.id,
		outcome: "resolved",
		display_name: displayName,
	};
}

function buildRequestUrl(baseUrl: URL, identity: BitJitaEntityIdentity): string {
	return new URL(`${BitJitaRouteByKind[identity.kind].apiPath}/${identity.id}`, baseUrl).toString();
}

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException
		? error.name === "AbortError"
		: typeof error === "object"
			&& error !== null
			&& "name" in error
			&& error.name === "AbortError";
}

function isUnavailableStatus(status: number): boolean {
	return status === 408
		|| status === 409
		|| status === 425
		|| status === 429
		|| (status >= 500 && status <= 599);
}

async function fetchBitJitaResponse(requestUrl: string): Promise<Response | "unavailable"> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), BITJITA_REQUEST_TIMEOUT_MS);
	try {
		return await fetch(requestUrl, {
			headers: {
				Accept: "application/json",
				"User-Agent": "bc-news",
				"x-app-identifier": "bc-news",
			},
			signal: controller.signal,
		});
	} catch (error) {
		if (isAbortError(error) || error instanceof TypeError) {
			return "unavailable";
		}
		throw error;
	} finally {
		clearTimeout(timeout);
	}
}

async function resolveIdentity(
	baseUrl: URL,
	identity: BitJitaEntityIdentity,
): Promise<GameReferenceEntityResolution> {
	const response = await fetchBitJitaResponse(buildRequestUrl(baseUrl, identity));
	if (response === "unavailable") {
		return unavailableResolution(identity);
	}
	if (response.status === 404) {
		return unknownResolution(identity);
	}
	if (isUnavailableStatus(response.status)) {
		return unavailableResolution(identity);
	}
	if (!response.ok) {
		throw new BitJitaGameReferenceDeterministicError(
			"bitjita_game_reference_http_status_invalid",
			`BitJita ${identity.kind} lookup returned HTTP ${response.status}`,
		);
	}

	let payload: unknown;
	try {
		payload = await response.json();
	} catch (error) {
		throw new BitJitaGameReferenceDeterministicError(
			"bitjita_game_reference_invalid_json",
			`BitJita ${identity.kind} lookup returned invalid JSON`,
			{ cause: error },
		);
	}

	const resolvedEntity = parseBitJitaEntityPayload(identity.kind, payload);
	if (resolvedEntity.responseId !== identity.id) {
		throw new BitJitaGameReferenceDeterministicError(
			"bitjita_game_reference_id_mismatch",
			`BitJita ${identity.kind} lookup returned a mismatched entity id`,
		);
	}

	return resolvedResolution(identity, resolvedEntity.displayName);
}

export function createBitJitaGameReferenceResolver(baseUrl: string): GameReferenceResolverPort {
	const normalizedBaseUrl = normalizeBitJitaBaseUrl(baseUrl);

	return {
		async resolve(identities): Promise<readonly GameReferenceEntityResolution[]> {
			const normalizedIdentities = identities.map(normalizeBitJitaIdentity);
			const requested = normalizedIdentities.slice(0, BITJITA_RESOLVE_REQUEST_BUDGET);
			const resolved = await Promise.all(
				requested.map((identity) => resolveIdentity(normalizedBaseUrl, identity)),
			);
			const exhausted = normalizedIdentities
				.slice(BITJITA_RESOLVE_REQUEST_BUDGET)
				.map((identity) => requestBudgetExhaustedResolution(identity));
			return [...resolved, ...exhausted];
		},
	};
}
