import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { recordedJudgeModelProvider, recordedModelProvider } from "@bc-news/fixtures";
import { WORKSPACE_ROOT } from "../src/fingerprint";
import { runCommand } from "../src/run-command";

afterEach(() => vi.restoreAllMocks());

test("completes production generation serially before judging in roster order", async () => {
	const calls: string[] = [];
	const generate = recordedModelProvider.complete.bind(recordedModelProvider);
	const judge = recordedJudgeModelProvider.complete.bind(recordedJudgeModelProvider);
	vi.spyOn(recordedModelProvider, "complete").mockImplementation(async (request) => {
		calls.push(`generate:${request.editorialCapability}`);
		return generate(request);
	});
	vi.spyOn(recordedJudgeModelProvider, "complete").mockImplementation(async (request) => {
		calls.push(`judge:${request.editorialCapability}`);
		return judge(request);
	});

	const resultsDirectory = await mkdtemp(join(tmpdir(), "bc-news-eval-order-"));
	await runCommand({
		fixturePath: join(WORKSPACE_ROOT, "packages/fixtures/evidence/active-region-7_2026-01-24.json"),
		configPath: join(WORKSPACE_ROOT, "apps/eval/eval.config.json"),
		resultsDirectory,
		noJudge: false,
	});

	expect(calls).toEqual([
		"generate:main_story",
		"generate:announcements",
		"generate:packaging",
		"judge:main_story",
		"judge:announcements",
		"judge:packaging",
	]);
});

test("the no-judge lane makes no judge calls", async () => {
	const judge = vi.spyOn(recordedJudgeModelProvider, "complete");
	const resultsDirectory = await mkdtemp(join(tmpdir(), "bc-news-eval-order-"));
	await runCommand({
		fixturePath: join(WORKSPACE_ROOT, "packages/fixtures/evidence/active-region-7_2026-01-24.json"),
		configPath: join(WORKSPACE_ROOT, "apps/eval/eval.config.json"),
		resultsDirectory,
		noJudge: true,
	});
	expect(judge).not.toHaveBeenCalled();
});
