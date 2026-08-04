import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import {
	parseSingleWranglerCron,
	readSingleWranglerCron,
} from "../../../scripts/walk/wrangler-cron";

it("ignores a comment-only cron and rejects the missing root triggers object", () => {
	expect(() =>
		parseSingleWranglerCron(
			`{
				// "triggers": { "crons": ["0 0 * * *"] }
				"name": "comment-only"
			}`,
			"comment-only.jsonc",
		),
	).toThrow("must define a root triggers object");
});

it("rejects a crons key nested under the wrong root object", () => {
	expect(() =>
		parseSingleWranglerCron(
			`{ "other": { "crons": ["0 0 * * *"] } }`,
			"wrong-object.jsonc",
		),
	).toThrow("must define a root triggers object");
});

it.each([
	{ source: `{ "triggers": {} }`, label: "missing" },
	{ source: `{ "triggers": { "crons": [] } }`, label: "empty" },
	{ source: `{ "triggers": { "crons": ["a", "b"] } }`, label: "multiple" },
	{ source: `{ "triggers": { "crons": [7] } }`, label: "non-string" },
	{ source: `{ "triggers": { "crons": ["   "] } }`, label: "blank" },
] as const)("rejects $label triggers.crons entries", ({ source }) => {
	expect(() => parseSingleWranglerCron(source, "invalid.jsonc")).toThrow(
		"must define triggers.crons as exactly one non-empty string",
	);
});

it("accepts both real Worker cron configurations", async () => {
	const testsDirectory = dirname(fileURLToPath(import.meta.url));
	const generationConfig = join(testsDirectory, "..", "..", "generation", "wrangler.jsonc");
	const ingestConfig = join(testsDirectory, "..", "wrangler.jsonc");

	await expect(readSingleWranglerCron(generationConfig)).resolves.toBe("0 0 * * *");
	await expect(readSingleWranglerCron(ingestConfig)).resolves.toBe("*/1 * * * *");
});
