import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { RECORDED_REPLAY_CONFIG_PATH } from "../src/recorded-replay-acceptance-verifier";
import { REPRESENTATIVE_FIXTURE_PATH } from "../src/representative-fixture";
import { runCommand } from "../src/run-command";
import { listRunFiles, loadRunFile, saveRunFile } from "../src/run-file";

test("round-trips a current strict four-step run", async () => {
	const directory = await mkdtemp(join(tmpdir(), "bc-news-eval-roundtrip-"));
	const { run } = await runCommand({
		fixturePath: REPRESENTATIVE_FIXTURE_PATH,
		configPath: RECORDED_REPLAY_CONFIG_PATH,
		resultsDirectory: directory,
		environment: {},
	});
	const copy = { ...run, id: `${run.id}-copy` };
	const path = await saveRunFile(copy, directory);
	const loaded = await loadRunFile(copy.id, directory);

	expect(loaded.id).toBe(copy.id);
	expect(loaded.steps).toHaveLength(4);
	await expect(readFile(path, "utf8")).resolves.toContain(copy.id);
});

test("recorded replay reports no token measurement and no external billing", async () => {
	const { run } = await runCommand({
		fixturePath: REPRESENTATIVE_FIXTURE_PATH,
		configPath: RECORDED_REPLAY_CONFIG_PATH,
		resultsDirectory: await mkdtemp(join(tmpdir(), "bc-news-eval-replay-usage-")),
		environment: {},
	});

	for (const step of run.steps) {
		expect(step.model_usage.token_usage).toEqual({ measurement: "unavailable" });
		expect(step.model_usage.external_billing).toEqual({
			classification: "none",
			amount_usd: 0,
			reason: "recorded_replay",
		});
	}
});

test("listing reports a rejected run and preserves valid listings", async () => {
	const directory = await mkdtemp(join(tmpdir(), "bc-news-eval-listing-"));
	const { run } = await runCommand({
		fixturePath: REPRESENTATIVE_FIXTURE_PATH,
		configPath: RECORDED_REPLAY_CONFIG_PATH,
		resultsDirectory: directory,
		environment: {},
	});
	const rejectedPath = join(directory, "rejected.json");
	await writeFile(rejectedPath, "not json", "utf8");
	const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

	try {
		const listed = await listRunFiles(directory);

		expect(listed.map((candidate) => candidate.id)).toContain(run.id);
		expect(stderr).toHaveBeenCalledWith(
			`Rejected saved run ${rejectedPath}: invalid saved run JSON\n`,
		);
	} finally {
		stderr.mockRestore();
	}
});
