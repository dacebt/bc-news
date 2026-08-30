import { NonRetryableError } from "cloudflare:workflows";
import { afterEach, expect, it, vi } from "vitest";
import {
	BitJitaGameReferenceDeterministicError,
	createBitJitaGameReferenceResolver,
} from "../src/adapters/bitjita-game-reference-resolver";
import { failNonRetryablyOnDeterministicErrors } from "../src/non-retryable";

afterEach(() => {
	vi.restoreAllMocks();
});

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function requestUrlString(requestInfo: RequestInfo | URL): string {
	if (requestInfo instanceof Request) {
		return requestInfo.url;
	}
	return requestInfo.toString();
}

it.each([
	[
		"item",
		"123",
		"https://example.test/bitjita/api/items/123",
		"Stone Block",
		{ item: { id: "123", name: "Stone Block", ignored: true } },
	],
	[
		"cargo",
		"456",
		"https://example.test/bitjita/api/cargo/456",
		"Trade Goods",
		{ cargo: { id: "456", name: "Trade Goods" } },
	],
	[
		"claim",
		"90071992547409931234",
		"https://example.test/bitjita/api/claims/90071992547409931234",
		"Harbor Hold",
		{ claim: { entityId: "90071992547409931234", name: "Harbor Hold" } },
	],
	[
		"coll",
		"789",
		"https://example.test/bitjita/api/collectibles/789",
		"Festival Lantern",
		{ collectible: { id: "789", name: "Festival Lantern" } },
	],
	[
		"res",
		"321",
		"https://example.test/bitjita/api/resources/321",
		"Copper Vein",
		{ resource: { id: "321", name: "Copper Vein" } },
	],
] as const)("resolves %s envelopes against the configured base subpath", async (kind, id, expectedUrl, expectedName, payload) => {
	const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(payload));
	const resolver = createBitJitaGameReferenceResolver("https://example.test/bitjita");

	await expect(resolver.resolve([{ kind, id }])).resolves.toEqual([
		{ kind, id, outcome: "resolved", display_name: expectedName },
	]);

	expect(fetchSpy).toHaveBeenCalledTimes(1);
	const firstCall = fetchSpy.mock.calls[0];
	if (firstCall === undefined) {
		throw new Error("expected BitJita fetch call");
	}
	const [requestUrl, requestInit] = firstCall;
	expect(requestUrlString(requestUrl)).toBe(expectedUrl);
	expect(requestInit).toMatchObject({
		headers: {
			Accept: "application/json",
			"User-Agent": "bc-news",
			"x-app-identifier": "bc-news",
		},
	});
});

it("accepts safe integer ids and normalizes a numeric upstream id", async () => {
	const resolver = createBitJitaGameReferenceResolver("https://example.test/root/");
	vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
		item: { id: 42, name: "Safe Integer Item" },
	}));

	await expect(resolver.resolve([{ kind: "item", id: 42 as unknown as string }])).resolves.toEqual([
		{ kind: "item", id: "42", outcome: "resolved", display_name: "Safe Integer Item" },
	]);
});

it("rejects an unsafe numeric request id before any fetch", async () => {
	const fetchSpy = vi.spyOn(globalThis, "fetch");
	const resolver = createBitJitaGameReferenceResolver("https://example.test/root/");

	await expect(
		resolver.resolve([{ kind: "item", id: (Number.MAX_SAFE_INTEGER + 1) as unknown as string }]),
	).rejects.toMatchObject({
		name: "BitJitaGameReferenceDeterministicError",
		code: "bitjita_game_reference_unsafe_numeric_id",
	});

	expect(fetchSpy).not.toHaveBeenCalled();
});

it("rejects an unsafe numeric upstream id", async () => {
	const resolver = createBitJitaGameReferenceResolver("https://example.test/root/");
	vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
		item: { id: Number.MAX_SAFE_INTEGER + 1, name: "Unsafe" },
	}));

	await expect(resolver.resolve([{ kind: "item", id: "42" }])).rejects.toMatchObject({
		name: "BitJitaGameReferenceDeterministicError",
		code: "bitjita_game_reference_unsafe_numeric_id",
	});
});

it("rejects a mismatched upstream id", async () => {
	const resolver = createBitJitaGameReferenceResolver("https://example.test/root/");
	vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({
		item: { id: "43", name: "Wrong Item" },
	}));

	await expect(resolver.resolve([{ kind: "item", id: "42" }])).rejects.toMatchObject({
		name: "BitJitaGameReferenceDeterministicError",
		code: "bitjita_game_reference_id_mismatch",
	});
});

it("rejects invalid JSON and invalid envelopes deterministically", async () => {
	const resolver = createBitJitaGameReferenceResolver("https://example.test/root/");
	const fetchSpy = vi.spyOn(globalThis, "fetch");

	fetchSpy.mockResolvedValueOnce(new Response("{", {
		status: 200,
		headers: { "Content-Type": "application/json" },
	}));
	await expect(resolver.resolve([{ kind: "item", id: "42" }])).rejects.toMatchObject({
		name: "BitJitaGameReferenceDeterministicError",
		code: "bitjita_game_reference_invalid_json",
	});

	fetchSpy.mockResolvedValueOnce(jsonResponse({ item: { id: "42" } }));
	await expect(resolver.resolve([{ kind: "item", id: "42" }])).rejects.toMatchObject({
		name: "BitJitaGameReferenceDeterministicError",
		code: "bitjita_game_reference_response_invalid",
	});

	fetchSpy.mockResolvedValueOnce(jsonResponse({ item: { id: "42", name: " " } }));
	await expect(resolver.resolve([{ kind: "item", id: "42" }])).rejects.toMatchObject({
		name: "BitJitaGameReferenceDeterministicError",
		code: "bitjita_game_reference_invalid_name",
	});
});

it.each([
	[404, "unknown"],
	[408, "unavailable"],
	[409, "unavailable"],
	[425, "unavailable"],
	[429, "unavailable"],
	[500, "unavailable"],
] as const)("maps HTTP %s to %s", async (status, outcome) => {
	const resolver = createBitJitaGameReferenceResolver("https://example.test/root/");
	vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status }));

	await expect(resolver.resolve([{ kind: "item", id: "42" }])).resolves.toEqual([
		{ kind: "item", id: "42", outcome },
	]);
});

it("treats fetch network failures and aborts as unavailable", async () => {
	const resolver = createBitJitaGameReferenceResolver("https://example.test/root/");
	const fetchSpy = vi.spyOn(globalThis, "fetch");

	fetchSpy.mockRejectedValueOnce(new TypeError("fetch failed"));
	await expect(resolver.resolve([{ kind: "item", id: "42" }])).resolves.toEqual([
		{ kind: "item", id: "42", outcome: "unavailable" },
	]);

	fetchSpy.mockRejectedValueOnce(new DOMException("timed out", "AbortError"));
	await expect(resolver.resolve([{ kind: "item", id: "42" }])).resolves.toEqual([
		{ kind: "item", id: "42", outcome: "unavailable" },
	]);
});

it.each([400, 401, 403] as const)("rejects non-retryable HTTP %s deterministically", async (status) => {
	const resolver = createBitJitaGameReferenceResolver("https://example.test/root/");
	vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status }));

	await expect(resolver.resolve([{ kind: "item", id: "42" }])).rejects.toMatchObject({
		name: "BitJitaGameReferenceDeterministicError",
		code: "bitjita_game_reference_http_status_invalid",
	});
});

it("caps each resolution call at 18 fetches, preserves order, and marks later identities as budget exhausted", async () => {
	const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((requestUrl) => {
		const url = requestUrlString(requestUrl);
		const id = url.split("/").at(-1);
		if (id === undefined) {
			throw new Error("missing id");
		}
		return Promise.resolve(jsonResponse({ item: { id, name: `Item ${id}` } }));
	});
	const resolver = createBitJitaGameReferenceResolver("https://example.test/root/");
	const identities = Array.from({ length: 19 }, (_, index) => ({
		kind: "item" as const,
		id: String(index + 1),
	}));

	await expect(resolver.resolve(identities)).resolves.toEqual([
		...identities.slice(0, 18).map(({ kind, id }) => ({
			kind,
			id,
			outcome: "resolved" as const,
			display_name: `Item ${id}`,
		})),
		{ kind: "item", id: "19", outcome: "request_budget_exhausted" },
	]);

	expect(fetchSpy).toHaveBeenCalledTimes(18);
	expect(fetchSpy.mock.calls.map(([requestUrl]) => requestUrlString(requestUrl).split("/").at(-1))).toEqual(
		identities.slice(0, 18).map(({ id }) => id),
	);
});

it("routes deterministic BitJita failures through the Workflow non-retryable boundary", async () => {
	await expect(
		failNonRetryablyOnDeterministicErrors(() => {
			throw new BitJitaGameReferenceDeterministicError(
				"bitjita_game_reference_response_invalid",
				"BitJita item lookup returned an invalid response envelope",
			);
		}),
	).rejects.toBeInstanceOf(NonRetryableError);
});
