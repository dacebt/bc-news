import type { GenerationRunParams } from "@bc-news/contracts";

export const ALLOWED_NOT_FOUND_PAIRS: readonly GenerationRunParams[] = [
	{ active_region_id: "8", publication_date: "2026-08-25" },
	{ active_region_id: "7", publication_date: "2026-08-26" },
];

export const ALLOWED_NOT_FOUND_CONSOLE_ERROR =
	"Failed to load resource: the server responded with a status of 404 (Not Found)";

export function pairKey(pair: GenerationRunParams): string {
	return `${pair.active_region_id}/${pair.publication_date}`;
}

export function requestOriginViolation(requestUrl: string, expectedOrigin: string): string | null {
	let url: URL;
	try {
		url = new URL(requestUrl);
	} catch {
		return `browser requested an invalid URL: ${requestUrl}`;
	}
	return url.origin === expectedOrigin
		? null
		: `browser attempted external origin ${url.origin}: ${requestUrl}`;
}

export function responseViolation(
	responseUrl: string,
	status: number,
	expectedOrigin: string,
): { violation: string | null; allowedNotFoundPair: string | null; allowedNotFoundUrl: string | null } {
	const originViolation = requestOriginViolation(responseUrl, expectedOrigin);
	if (originViolation !== null) {
		return { violation: originViolation, allowedNotFoundPair: null, allowedNotFoundUrl: null };
	}
	if (status >= 200 && status < 300) {
		return { violation: null, allowedNotFoundPair: null, allowedNotFoundUrl: null };
	}

	const url = new URL(responseUrl);
	const hasExactPairQuery = url.searchParams.size === 2
		&& url.searchParams.getAll("active_region_id").length === 1
		&& url.searchParams.getAll("publication_date").length === 1;
	if (status === 404 && url.pathname === "/api/edition" && hasExactPairQuery) {
		const pair = {
			active_region_id: url.searchParams.get("active_region_id") ?? "",
			publication_date: url.searchParams.get("publication_date") ?? "",
		};
		const key = pairKey(pair);
		if (ALLOWED_NOT_FOUND_PAIRS.some((allowed) => pairKey(allowed) === key)) {
			return { violation: null, allowedNotFoundPair: key, allowedNotFoundUrl: url.toString() };
		}
	}
	return {
		violation: `browser received HTTP ${String(status)} from ${responseUrl}`,
		allowedNotFoundPair: null,
		allowedNotFoundUrl: null,
	};
}

function normalizedUrl(rawUrl: string): string | null {
	try {
		return new URL(rawUrl).toString();
	} catch {
		return null;
	}
}

export function requestFailureViolation(
	requestUrl: string,
	errorText: string,
	observedAllowedNotFoundUrls: ReadonlySet<string>,
): string | null {
	const url = normalizedUrl(requestUrl);
	if (
		errorText === "net::ERR_ABORTED"
		&& url !== null
		&& observedAllowedNotFoundUrls.has(url)
	) {
		return null;
	}
	return `browser request failed: ${requestUrl} (${errorText})`;
}

export function consoleErrorViolation(
	message: string,
	locationUrl: string,
	observedAllowedNotFoundUrls: ReadonlySet<string>,
): string | null {
	const url = normalizedUrl(locationUrl);
	if (
		message === ALLOWED_NOT_FOUND_CONSOLE_ERROR
		&& url !== null
		&& observedAllowedNotFoundUrls.has(url)
	) {
		return null;
	}
	return `browser console error: ${message}`;
}
