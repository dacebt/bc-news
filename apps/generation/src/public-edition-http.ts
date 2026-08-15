import {
	ACTIVE_REGION_IDS,
	GenerationRunParamsSchema,
	type GenerationRunParams,
} from "@bc-news/contracts";
import { getPublishedEdition } from "./routes";

const ALLOWED_QUERY_PARAMETERS = new Set(["active_region_id", "publication_date"]);
const PUBLIC_EDITION_CACHE_CONTROL = "public, max-age=300, s-maxage=3600";
const RETRY_AFTER_SECONDS = "60";

export interface EditionResponseCache {
	match(request: Request): Promise<Response | undefined>;
	put(request: Request, response: Response): Promise<void>;
}

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json", ...headers },
	});
}

function unavailableResponse(): Response {
	return jsonResponse(503, { error: "edition_api_unavailable" }, { "Cache-Control": "no-store" });
}

function parseEditionQuery(url: URL): GenerationRunParams | undefined {
	const keys = [...url.searchParams.keys()];
	if (
		keys.length !== 2
		|| keys.some((key) => !ALLOWED_QUERY_PARAMETERS.has(key))
		|| url.searchParams.getAll("active_region_id").length !== 1
		|| url.searchParams.getAll("publication_date").length !== 1
	) {
		return undefined;
	}

	const result = GenerationRunParamsSchema.safeParse({
		active_region_id: url.searchParams.get("active_region_id"),
		publication_date: url.searchParams.get("publication_date"),
	});
	if (!result.success || !ACTIVE_REGION_IDS.includes(result.data.active_region_id)) {
		return undefined;
	}
	return result.data;
}

function canonicalCacheRequest(origin: string, params: GenerationRunParams): Request {
	const url = new URL("/api/edition", origin);
	url.searchParams.set("active_region_id", params.active_region_id);
	url.searchParams.set("publication_date", params.publication_date);
	return new Request(url, { method: "GET" });
}

function rateLimitKey(request: Request): string {
	const clientAddress = request.headers.get("CF-Connecting-IP")?.trim();
	return clientAddress === undefined || clientAddress.length === 0
		? "local-reader"
		: clientAddress;
}

function logCachePopulationFailure(error: unknown): void {
	console.error("edition cache population failed", {
		name: error instanceof Error ? error.name : "UnknownError",
	});
}

export async function servePublicEdition(
	request: Request,
	env: Env,
	context?: Pick<ExecutionContext, "waitUntil">,
	cache: EditionResponseCache = caches.default,
): Promise<Response> {
	let rateLimitOutcome: RateLimitOutcome;
	try {
		rateLimitOutcome = await env.EDITION_API_RATE_LIMITER.limit({ key: rateLimitKey(request) });
	} catch (error) {
		console.error("edition rate limit unavailable", {
			name: error instanceof Error ? error.name : "UnknownError",
		});
		return unavailableResponse();
	}
	if (!rateLimitOutcome.success) {
		return jsonResponse(
			429,
			{ error: "edition_rate_limit_exceeded" },
			{ "Cache-Control": "no-store", "Retry-After": RETRY_AFTER_SECONDS },
		);
	}

	const requestUrl = new URL(request.url);
	const params = parseEditionQuery(requestUrl);
	if (params === undefined) {
		return jsonResponse(
			400,
			{ error: "invalid_edition_request" },
			{ "Cache-Control": "no-store" },
		);
	}

	const cacheKey = canonicalCacheRequest(requestUrl.origin, params);
	let cached: Response | undefined;
	try {
		cached = await cache.match(cacheKey);
	} catch (error) {
		console.error("edition cache read failed", {
			name: error instanceof Error ? error.name : "UnknownError",
		});
		return unavailableResponse();
	}
	if (cached !== undefined) return cached;

	let response: Response;
	try {
		response = await getPublishedEdition(params, env);
	} catch (error) {
		console.error("edition request failed", {
			name: error instanceof Error ? error.name : "UnknownError",
		});
		return unavailableResponse();
	}
	if (response.status !== 200) return response;
	if (context === undefined) return unavailableResponse();

	const cacheableResponse = new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});
	cacheableResponse.headers.set("Cache-Control", PUBLIC_EDITION_CACHE_CONTROL);
	context.waitUntil(
		cache.put(cacheKey, cacheableResponse.clone()).catch(logCachePopulationFailure),
	);
	return cacheableResponse;
}
