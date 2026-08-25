import assert from "node:assert/strict";
import test from "node:test";
import {
	ALLOWED_NOT_FOUND_CONSOLE_ERROR,
	consoleErrorViolation,
	requestFailureViolation,
	requestOriginViolation,
	responseViolation,
} from "../walk/browser-policy";

const ORIGIN = "http://127.0.0.1:8852";

void test("rejects external requests before navigation", () => {
	assert.match(requestOriginViolation("https://bccodex.com/", ORIGIN) ?? "", /external origin/);
	assert.equal(requestOriginViolation(`${ORIGIN}/assets/index.js`, ORIGIN), null);
});

void test("permits only the two pair-addressed 404 responses", () => {
	assert.deepEqual(
		responseViolation(`${ORIGIN}/api/edition?active_region_id=8&publication_date=2026-08-25`, 404, ORIGIN),
		{
			violation: null,
			allowedNotFoundPair: "8/2026-08-25",
			allowedNotFoundUrl: `${ORIGIN}/api/edition?active_region_id=8&publication_date=2026-08-25`,
		},
	);
	assert.deepEqual(
		responseViolation(`${ORIGIN}/api/edition?active_region_id=7&publication_date=2026-08-26`, 404, ORIGIN),
		{
			violation: null,
			allowedNotFoundPair: "7/2026-08-26",
			allowedNotFoundUrl: `${ORIGIN}/api/edition?active_region_id=7&publication_date=2026-08-26`,
		},
	);
	assert.match(
		responseViolation(`${ORIGIN}/api/edition?active_region_id=9&publication_date=2026-08-25`, 404, ORIGIN).violation ?? "",
		/HTTP 404/,
	);
	assert.match(responseViolation(`${ORIGIN}/assets/index.js`, 500, ORIGIN).violation ?? "", /HTTP 500/);
});

void test("suppresses only derivative failures from an observed exact allowed 404 URL", () => {
	const allowedUrl = `${ORIGIN}/api/edition?active_region_id=8&publication_date=2026-08-25`;
	const observed = new Set([allowedUrl]);
	assert.equal(requestFailureViolation(allowedUrl, "net::ERR_ABORTED", observed), null);
	assert.equal(consoleErrorViolation(ALLOWED_NOT_FOUND_CONSOLE_ERROR, allowedUrl, observed), null);

	assert.match(requestFailureViolation(allowedUrl, "net::ERR_ABORTED", new Set()) ?? "", /request failed/);
	assert.match(requestFailureViolation(`${allowedUrl}&extra=1`, "net::ERR_ABORTED", observed) ?? "", /request failed/);
	assert.match(requestFailureViolation(allowedUrl, "net::ERR_FAILED", observed) ?? "", /request failed/);
	assert.match(consoleErrorViolation(ALLOWED_NOT_FOUND_CONSOLE_ERROR, `${allowedUrl}&extra=1`, observed) ?? "", /console error/);
	assert.match(consoleErrorViolation("Unexpected console failure", allowedUrl, observed) ?? "", /console error/);
});

void test("rejects extra and duplicate query parameters on allowed 404 pairs", () => {
	assert.match(
		responseViolation(`${ORIGIN}/api/edition?active_region_id=8&publication_date=2026-08-25&extra=1`, 404, ORIGIN).violation ?? "",
		/HTTP 404/,
	);
	assert.match(
		responseViolation(`${ORIGIN}/api/edition?active_region_id=8&active_region_id=8&publication_date=2026-08-25`, 404, ORIGIN).violation ?? "",
		/HTTP 404/,
	);
	assert.match(
		responseViolation(`${ORIGIN}/api/edition?active_region_id=8&publication_date=2026-08-25&publication_date=2026-08-25`, 404, ORIGIN).violation ?? "",
		/HTTP 404/,
	);
});
