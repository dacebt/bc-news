import assert from "node:assert/strict";
import test from "node:test";
import {
	assertCacheControl,
	assertSecurityResponseHeaders,
	NON_CACHEABLE_RESPONSE_CACHE_CONTROL,
	PUBLIC_EDITION_CACHE_CONTROL,
} from "../walk/security-response-headers";

const SECURITY_HEADERS = {
	"Content-Security-Policy": "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'none'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'none'",
	"Permissions-Policy": "accelerometer=(), autoplay=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
	"Referrer-Policy": "no-referrer",
	"X-Content-Type-Options": "nosniff",
	"X-Frame-Options": "DENY",
} as const;

void test("accepts the exact browser-security response policy", () => {
	const response = new Response(null, { headers: SECURITY_HEADERS });

	assert.doesNotThrow(() => assertSecurityResponseHeaders(response, "reader response"));
});

void test("rejects a missing or changed browser-security header", () => {
	const missing = new Response(null, {
		headers: Object.fromEntries(
			Object.entries(SECURITY_HEADERS).filter(([name]) => name !== "X-Frame-Options"),
		),
	});
	assert.throws(
		() => assertSecurityResponseHeaders(missing, "reader response"),
		/reader response expected x-frame-options: "DENY", got null/,
	);

	const changed = new Response(null, {
		headers: { ...SECURITY_HEADERS, "Referrer-Policy": "same-origin" },
	});
	assert.throws(
		() => assertSecurityResponseHeaders(changed, "reader response"),
		/reader response expected referrer-policy: "no-referrer", got "same-origin"/,
	);
});

void test("rejects CORS and HSTS additions outside the frozen policy", () => {
	const cors = new Response(null, {
		headers: { ...SECURITY_HEADERS, "Access-Control-Allow-Origin": "*" },
	});
	assert.throws(
		() => assertSecurityResponseHeaders(cors, "reader response"),
		/reader response must not expose CORS header access-control-allow-origin/,
	);

	const hsts = new Response(null, {
		headers: { ...SECURITY_HEADERS, "Strict-Transport-Security": "max-age=31536000" },
	});
	assert.throws(
		() => assertSecurityResponseHeaders(hsts, "reader response"),
		/reader response must not declare strict-transport-security/,
	);
});

void test("requires the exact cache policy for successful and failed edition responses", () => {
	const published = new Response(null, {
		headers: { "Cache-Control": PUBLIC_EDITION_CACHE_CONTROL },
	});
	assert.doesNotThrow(() =>
		assertCacheControl(published, PUBLIC_EDITION_CACHE_CONTROL, "published edition"),
	);

	const notFound = new Response(null, {
		headers: { "Cache-Control": NON_CACHEABLE_RESPONSE_CACHE_CONTROL },
	});
	assert.doesNotThrow(() =>
		assertCacheControl(notFound, NON_CACHEABLE_RESPONSE_CACHE_CONTROL, "unknown edition pair"),
	);
	assert.throws(
		() => assertCacheControl(notFound, PUBLIC_EDITION_CACHE_CONTROL, "unknown edition pair"),
		/unknown edition pair expected cache-control: "public, max-age=300, s-maxage=3600", got "no-store"/,
	);
});
