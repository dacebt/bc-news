import { expect, it } from "vitest";
import { resolvePollConfig } from "../src/config";

it("accepts a local hierarchical HTTP API base", () => {
	expect(resolvePollConfig({ BITJITA_API_BASE: "http://localhost:8787/api" }).bitjitaApiBase).toBe(
		"http://localhost:8787/api",
	);
});

it.each(["ftp://example.com/api", "file:///tmp/messages", "mailto:operator@example.com"])(
	"rejects non-HTTP API base %s",
	(BITJITA_API_BASE) => {
		expect(() => resolvePollConfig({ BITJITA_API_BASE })).toThrow("Poll config vars rejected");
	},
);

it("rejects an HTTP API base without a hierarchical separator", () => {
	expect(() => resolvePollConfig({ BITJITA_API_BASE: "http:example.com/api" })).toThrow(
		"Poll config vars rejected",
	);
});
