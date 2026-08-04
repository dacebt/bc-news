import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { generateRunId, listRunFiles, loadRunFile, saveRunFile, type RunFile } from "../src/run-file";

function hash(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function sampleRun(id: string): RunFile {
	return {
		id,
		config: { capabilities: { main_story: { adapter: "recorded" } }, judge: null },
		fixture: { path: "packages/fixtures/evidence/active-region-7_2026-01-24.json", fixture_sha256: hash("fixture") },
		steps: [
			{
				capability: "main_story",
				prompt_sha256: hash("prompt"),
				output: { main_story: { headline: "h", lede: "l", body: "b" } },
				schema_valid: true,
				checks: [{ name: "injection", passed: true, detail: "no injection markers" }],
				judge: null,
			},
		],
		started_at: "2026-01-25T00:00:00.000Z",
		completed_at: "2026-01-25T00:00:01.000Z",
		fingerprint: {
			provider_params: { main_story: { provider: "recorded", model: "recorded-fixture" } },
			fixture_sha256: hash("fixture"),
			checks_sha256: hash("checks"),
			providers_sha256: hash("providers"),
			rubrics_sha256: hash(""),
			schemas_sha256: hash("schemas"),
			code_version: "deadbeef",
		},
	};
}

async function tempResultsDirectory(): Promise<string> {
	return mkdtemp(join(tmpdir(), "bc-news-eval-"));
}

test("round-trips a strictly-written run through the permissive read schema", async () => {
	const directory = await tempResultsDirectory();
	const run = sampleRun(generateRunId());
	const path = await saveRunFile(run, directory);

	const read = await loadRunFile(run.id, directory);

	expect(read.id).toBe(run.id);
	expect(read.fixture?.fixture_sha256).toBe(run.fixture.fixture_sha256);
	expect(read.steps).toHaveLength(1);
	expect(read.steps[0]?.capability).toBe("main_story");
	expect(read.fingerprint?.code_version).toBe("deadbeef");
	await expect(readFile(path, "utf8")).resolves.toContain(run.id);
});

test("keeps both run files when ids collide", async () => {
	const directory = await tempResultsDirectory();
	const run = sampleRun(generateRunId());
	const firstPath = await saveRunFile(run, directory);
	const firstBytes = await readFile(firstPath, "utf8");

	const secondPath = await saveRunFile(run, directory);

	expect(secondPath).not.toBe(firstPath);
	const second: unknown = JSON.parse(await readFile(secondPath, "utf8"));
	expect((second as { id: string }).id).toBe(`${run.id}-2`);
	await expect(readFile(firstPath, "utf8")).resolves.toBe(firstBytes);
});

test("lists and shows a run file carrying unknown keys the write schema would reject", async () => {
	const directory = await tempResultsDirectory();
	const run = sampleRun(generateRunId());
	const withUnknownKeys = {
		...run,
		future_field: "from a later run-file shape",
		fingerprint: { ...run.fingerprint, future_fingerprint_field: 1 },
	};
	await writeFile(join(directory, `${run.id}.json`), `${JSON.stringify(withUnknownKeys)}\n`, {
		encoding: "utf8",
		flag: "wx",
	});

	const shown = await loadRunFile(run.id, directory);
	expect(shown.id).toBe(run.id);

	const listed = await listRunFiles(directory);
	expect(listed.map((entry) => entry.id)).toContain(run.id);
});
