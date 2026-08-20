import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { RECORDED_REPLAY_CONFIG_PATH } from "../src/recorded-replay-acceptance-verifier";
import { REPRESENTATIVE_FIXTURE_PATH } from "../src/representative-fixture";
import { runCommand } from "../src/run-command";
import { RunFileSchema, listRunFiles, loadRunFile, saveRunFile } from "../src/run-file";
import { formatRunDetail, formatRunListing, formatRunSummary } from "../src/report";

test("round-trips a current strict two-step run", async () => {
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
	expect(loaded.steps).toHaveLength(2);
	expect(loaded.diagnostics).toEqual(copy.diagnostics);
	expect(formatRunSummary(copy, path)).toContain("Diagnostics:");
	expect(formatRunSummary(copy, path)).not.toContain("Diagnostics: unknown");
	expect(formatRunListing([loaded])).toContain(`diagnostics: ${String(copy.diagnostics.length)} observed`);
	await expect(readFile(path, "utf8")).resolves.toContain(copy.id);
	const withoutDiagnostics = {
		id: copy.id,
		config: copy.config,
		fixture: copy.fixture,
		steps: copy.steps,
		edition: copy.edition,
		started_at: copy.started_at,
		completed_at: copy.completed_at,
	};
	expect(RunFileSchema.safeParse(withoutDiagnostics).success).toBe(false);
	expect(RunFileSchema.safeParse({
		...copy,
		diagnostics: [
			{
				kind: "final_product",
				production_step: "announcements_write",
				code: "forbidden_marker",
				message: "announcement diagnostic",
			},
			{
				kind: "final_product",
				production_step: "main_story_write",
				code: "forbidden_marker",
				message: "main-story diagnostic",
			},
		],
	}).success).toBe(false);
});

test("keeps absent historical diagnostics unknown instead of defaulting them to observed none", async () => {
	const directory = await mkdtemp(join(tmpdir(), "bc-news-eval-historical-run-"));
	const path = join(directory, "historical-run.json");
	await writeFile(path, `${JSON.stringify({ id: "historical-run", started_at: "old" })}\n`, "utf8");

	const loaded = await loadRunFile("historical-run", directory);
	expect(Object.hasOwn(loaded, "diagnostics")).toBe(false);
	expect(loaded.diagnostics).toBeUndefined();
	expect(formatRunListing([loaded])).toContain("diagnostics: unknown");
	expect(formatRunDetail(loaded)).not.toContain("diagnostics");
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
