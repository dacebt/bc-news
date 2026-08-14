const SECURITY_RESPONSE_HEADERS = [
	[
		"content-security-policy",
		"default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'none'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'none'",
	],
	[
		"permissions-policy",
		"accelerometer=(), autoplay=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
	],
	["referrer-policy", "no-referrer"],
	["x-content-type-options", "nosniff"],
	["x-frame-options", "DENY"],
] as const;

export const PUBLIC_EDITION_CACHE_CONTROL = "public, max-age=300, s-maxage=3600";
export const NON_CACHEABLE_RESPONSE_CACHE_CONTROL = "no-store";

function assertHeader(
	response: Response,
	headerName: string,
	expectedValue: string,
	operation: string,
): void {
	const actualValue = response.headers.get(headerName);
	if (actualValue !== expectedValue) {
		throw new Error(
			`${operation} expected ${headerName}: ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`,
		);
	}
}

export function assertSecurityResponseHeaders(response: Response, operation: string): void {
	for (const [headerName, expectedValue] of SECURITY_RESPONSE_HEADERS) {
		assertHeader(response, headerName, expectedValue, operation);
	}
	for (const [headerName] of response.headers) {
		if (headerName.startsWith("access-control-")) {
			throw new Error(`${operation} must not expose CORS header ${headerName}`);
		}
	}
	if (response.headers.has("strict-transport-security")) {
		throw new Error(`${operation} must not declare strict-transport-security`);
	}
}

export function assertCacheControl(
	response: Response,
	expectedValue: string,
	operation: string,
): void {
	assertHeader(response, "cache-control", expectedValue, operation);
}
