import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { recordedModelProvider } from "@bc-news/fixtures";
import { PRODUCTION_MODEL_STEPS } from "@bc-news/generation-core";
import { CANONICAL_CONFIG_PATH, CANONICAL_FIXTURE_PATH } from "../src/canonical-walk-verifier";
import { runCommand } from "../src/run-command";

afterEach(() => vi.restoreAllMocks());

test("executes the exact dependent four-step production roster serially", async () => {
	const calls: string[] = [];
	const complete = recordedModelProvider.complete.bind(recordedModelProvider);
	vi.spyOn(recordedModelProvider, "complete").mockImplementation(async (request) => {
		calls.push(request.productionStep);
		return complete(request);
	});

	await runCommand({
		fixturePath: CANONICAL_FIXTURE_PATH,
		configPath: CANONICAL_CONFIG_PATH,
		resultsDirectory: await mkdtemp(join(tmpdir(), "bc-news-eval-order-")),
		environment: {},
	});

	expect(calls).toEqual(PRODUCTION_MODEL_STEPS);
});
