import { env } from "cloudflare:workers";
import { expect, it, vi, type Mock } from "vitest";
import {
	CURRENT_EDITION_VERSION,
	type Edition,
} from "@bc-news/contracts";
import { publishEdition } from "../src/edition-store";
import { CONTENT_SECURITY_POLICY, PERMISSIONS_POLICY } from "../src/http-security";
import { dispatchGenerationRequest } from "../src/index";
import type { EditionResponseCache } from "../src/public-edition-http";

interface CapturedContext {
	context: Pick<ExecutionContext, "waitUntil">;
	promises: Promise<unknown>[];
	waitUntil: ReturnType<typeof vi.fn>;
}

interface ControlledCache extends EditionResponseCache {
	match: Mock<EditionResponseCache["match"]>;
	put: Mock<EditionResponseCache["put"]>;
}

function controlledContext(): CapturedContext {
	const promises: Promise<unknown>[] = [];
	const waitUntil = vi.fn((promise: Promise<unknown>) => {
		promises.push(promise);
	});
	return { context: { waitUntil }, promises, waitUntil };
}

function controlledCache(): ControlledCache {
	let storedUrl: string | undefined;
	let storedResponse: Response | undefined;
	return {
		match: vi.fn((request: Request) => Promise.resolve(
			storedUrl === request.url ? storedResponse?.clone() : undefined,
		)),
		put: vi.fn((request: Request, response: Response) => {
			storedUrl = request.url;
			storedResponse = response.clone();
			return Promise.resolve();
		}),
	};
}

function databaseWithPrepare(prepare: ReturnType<typeof vi.fn>): D1Database {
	return { prepare } as unknown as D1Database;
}

function generationEnv(
	limit: ReturnType<typeof vi.fn>,
	db: D1Database = env.DB,
): Env {
	return {
		...env,
		DB: db,
		EDITION_API_RATE_LIMITER: { limit } as RateLimit,
	};
}

function edition(publicationDate: string): Edition {
	return {
		version: CURRENT_EDITION_VERSION,
		active_region_id: "7",
		publication_date: publicationDate,
		title: "The Widmoria Muster",
		game_references: [],
		announcements: [],
		main_story: { headline: "Boundary held", lede: "A lede.", body: "A body." },
		meta: {
			generated_at_utc: `${publicationDate}T00:00:00.000Z`,
			editorial_products: {
				main_story: { provider: "recorded", model: "recorded/main-story-write-v1" },
				announcements: { provider: "recorded", model: "recorded/announcements-write-v1" },
			},
			counts: { raw_count: 1, after_filter_count: 1, after_burst_count: 1, final_count: 1 },
		},
	};
}

function editionRequest(publicationDate: string, init?: RequestInit): Request {
	return new Request(
		`http://worker.local/api/edition?active_region_id=7&publication_date=${publicationDate}`,
		init,
	);
}

function expectNoStore(response: Response): void {
	expect(response.headers.get("Cache-Control")).toBe("no-store");
}

function expectDynamicSecurityHeaders(response: Response): void {
	expect(response.headers.get("Content-Security-Policy")).toBe(CONTENT_SECURITY_POLICY);
	expect(response.headers.get("Permissions-Policy")).toBe(PERMISSIONS_POLICY);
	expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
	expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
	expect(response.headers.get("X-Frame-Options")).toBe("DENY");
}

it("binds the public-edition rate limiter in the Worker test runtime", () => {
	expect(typeof env.EDITION_API_RATE_LIMITER.limit).toBe("function");
});

it("rate-limits before query validation, cache access, or D1", async () => {
	const limit = vi.fn().mockResolvedValue({ success: false });
	const prepare = vi.fn();
	const cache = controlledCache();
	const response = await dispatchGenerationRequest(
		new Request("http://worker.local/api/edition", {
			headers: { "CF-Connecting-IP": "203.0.113.4" },
		}),
		generationEnv(limit, databaseWithPrepare(prepare)),
		undefined,
		cache,
	);

	expect(response.status).toBe(429);
	expect(await response.json()).toEqual({ error: "edition_rate_limit_exceeded" });
	expect(response.headers.get("Retry-After")).toBe("60");
	expectNoStore(response);
	expect(limit).toHaveBeenCalledWith({ key: "203.0.113.4" });
	expect(cache.match).not.toHaveBeenCalled();
	expect(prepare).not.toHaveBeenCalled();
});

it("sanitizes a rate-limiter rejection before cache access or D1", async () => {
	const limit = vi.fn().mockRejectedValue(new Error("private limiter detail"));
	const prepare = vi.fn();
	const cache = controlledCache();
	const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
	const response = await dispatchGenerationRequest(
		editionRequest("2026-05-01"),
		generationEnv(limit, databaseWithPrepare(prepare)),
		undefined,
		cache,
	);

	expect(response.status).toBe(503);
	expect(await response.json()).toEqual({ error: "edition_api_unavailable" });
	expectNoStore(response);
	expect(consoleError).toHaveBeenCalledWith("edition rate limit unavailable", { name: "Error" });
	expect(cache.match).not.toHaveBeenCalled();
	expect(prepare).not.toHaveBeenCalled();
	consoleError.mockRestore();
});

it.each([
	["missing pair member", "http://worker.local/api/edition?active_region_id=7"],
	["extra parameter", "http://worker.local/api/edition?active_region_id=7&publication_date=2026-05-02&view=full"],
	["duplicate parameter", "http://worker.local/api/edition?active_region_id=7&active_region_id=8&publication_date=2026-05-02"],
	["inactive region", "http://worker.local/api/edition?active_region_id=10&publication_date=2026-05-02"],
])("rejects an exact-query violation for %s before cache access or D1", async (_label, url) => {
	const limit = vi.fn().mockResolvedValue({ success: true });
	const prepare = vi.fn();
	const cache = controlledCache();
	const response = await dispatchGenerationRequest(
		new Request(url),
		generationEnv(limit, databaseWithPrepare(prepare)),
		undefined,
		cache,
	);

	expect(response.status).toBe(400);
	expect(await response.json()).toEqual({ error: "invalid_edition_request" });
	expectNoStore(response);
	expect(limit).toHaveBeenCalledWith({ key: "local-reader" });
	expect(cache.match).not.toHaveBeenCalled();
	expect(prepare).not.toHaveBeenCalled();
});

it("reuses one canonical cache entry across query ordering and irrelevant headers", async () => {
	const publicationDate = "2026-05-03";
	await publishEdition(env.DB, edition(publicationDate), `${publicationDate}T09:00:00.000Z`);
	const cache = controlledCache();
	const firstContext = controlledContext();
	const first = await dispatchGenerationRequest(
		new Request(
			`http://worker.local/api/edition?publication_date=${publicationDate}&active_region_id=7`,
			{ headers: { "X-Reader-Variation": "first" } },
		),
		generationEnv(vi.fn().mockResolvedValue({ success: true })),
		firstContext.context,
		cache,
	);

	expect(first.status).toBe(200);
	expect(first.headers.get("Cache-Control")).toBe("public, max-age=300, s-maxage=3600");
	expectDynamicSecurityHeaders(first);
	expect(firstContext.waitUntil).toHaveBeenCalledOnce();
	await Promise.all(firstContext.promises);
	expect(cache.put).toHaveBeenCalledOnce();
	const [cacheKey] = cache.put.mock.calls[0] as [Request, Response];
	expect(cacheKey.url).toBe(
		`http://worker.local/api/edition?active_region_id=7&publication_date=${publicationDate}`,
	);
	expect([...cacheKey.headers]).toEqual([]);

	const prepare = vi.fn(() => {
		throw new Error("D1 must not run on a cache hit");
	});
	const secondContext = controlledContext();
	const second = await dispatchGenerationRequest(
		editionRequest(publicationDate, { headers: { "X-Reader-Variation": "second" } }),
		generationEnv(
			vi.fn().mockResolvedValue({ success: true }),
			databaseWithPrepare(prepare),
		),
		secondContext.context,
		cache,
	);

	expect(second.status).toBe(200);
	expect((await second.json<Edition>()).main_story.headline).toBe("Boundary held");
	expect(prepare).not.toHaveBeenCalled();
	expect(secondContext.waitUntil).not.toHaveBeenCalled();
});

it("does not cache a missing-edition error", async () => {
	const publicationDate = "2026-05-04";
	const cache = controlledCache();
	const firstContext = controlledContext();
	const first = await dispatchGenerationRequest(
		editionRequest(publicationDate),
		generationEnv(vi.fn().mockResolvedValue({ success: true })),
		firstContext.context,
		cache,
	);

	expect(first.status).toBe(404);
	expectNoStore(first);
	expect(cache.put).not.toHaveBeenCalled();
	expect(firstContext.waitUntil).not.toHaveBeenCalled();

	await publishEdition(env.DB, edition(publicationDate), `${publicationDate}T09:00:00.000Z`);
	const secondContext = controlledContext();
	const second = await dispatchGenerationRequest(
		editionRequest(publicationDate),
		generationEnv(vi.fn().mockResolvedValue({ success: true })),
		secondContext.context,
		cache,
	);

	expect(second.status).toBe(200);
	expect(cache.put).toHaveBeenCalledOnce();
	await Promise.all(secondContext.promises);
});

it("sanitizes cache-read and edition-handler failures", async () => {
	const cacheReadFailure: ControlledCache = {
		match: vi.fn().mockRejectedValue(new Error("private cache detail")),
		put: vi.fn(),
	};
	const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
	const cacheResponse = await dispatchGenerationRequest(
		editionRequest("2026-05-05"),
		generationEnv(vi.fn().mockResolvedValue({ success: true })),
		controlledContext().context,
		cacheReadFailure,
	);

	const handlerResponse = await dispatchGenerationRequest(
		editionRequest("2026-05-06"),
		generationEnv(
			vi.fn().mockResolvedValue({ success: true }),
			databaseWithPrepare(vi.fn(() => {
				throw new Error("private D1 detail");
			})),
		),
		controlledContext().context,
		controlledCache(),
	);

	for (const response of [cacheResponse, handlerResponse]) {
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({ error: "edition_api_unavailable" });
		expectNoStore(response);
	}
	expect(consoleError).toHaveBeenCalledWith("edition cache read failed", { name: "Error" });
	expect(consoleError).toHaveBeenCalledWith("edition request failed", { name: "Error" });
	consoleError.mockRestore();
});

it("uses waitUntil and sanitizes an asynchronous cache-write rejection", async () => {
	const publicationDate = "2026-05-07";
	await publishEdition(env.DB, edition(publicationDate), `${publicationDate}T09:00:00.000Z`);
	const cache: ControlledCache = {
		match: vi.fn().mockResolvedValue(undefined),
		put: vi.fn().mockRejectedValue(new TypeError("private cache-write detail")),
	};
	const captured = controlledContext();
	const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
	const response = await dispatchGenerationRequest(
		editionRequest(publicationDate),
		generationEnv(vi.fn().mockResolvedValue({ success: true })),
		captured.context,
		cache,
	);

	expect(response.status).toBe(200);
	expect(captured.waitUntil).toHaveBeenCalledOnce();
	await Promise.all(captured.promises);
	expect(consoleError).toHaveBeenCalledWith("edition cache population failed", {
		name: "TypeError",
	});
	consoleError.mockRestore();
});

it("adds the exact dynamic security policy to public, operator, and error responses", async () => {
	const generation = generationEnv(vi.fn().mockResolvedValue({ success: true }));
	const responses = await Promise.all([
		dispatchGenerationRequest(new Request("http://worker.local/api/edition"), generation),
		dispatchGenerationRequest(new Request("http://worker.local/generation-run"), generation),
		dispatchGenerationRequest(new Request("http://worker.local/not-a-route"), generation),
	]);

	expect(responses.map((response) => response.status)).toEqual([400, 401, 404]);
	for (const response of responses) expectDynamicSecurityHeaders(response);
});
