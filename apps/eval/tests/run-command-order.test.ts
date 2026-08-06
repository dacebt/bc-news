import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { fixtureEvidenceInput, recordedModelProvider } from "@bc-news/fixtures";
import {
	PRODUCTION_MODEL_STEPS,
	prepareEvidence,
	type ModelCompletion,
	type ModelProviderPort,
	type ModelProviderRequest,
} from "@bc-news/generation-core";
import { CANONICAL_CONFIG_PATH, CANONICAL_FIXTURE_PATH } from "../src/canonical-walk-verifier";
import { executeProductionSteps } from "../src/production-step-runners";
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

test("retains exact requests and completions in production order", async () => {
	const messages = await fixtureEvidenceInput.loadEvidence({
		activeRegionId: "7",
		evidenceDate: "2026-01-24",
	});
	const preparedEvidence = prepareEvidence({
		activeRegionId: "7",
		publicationDate: "2026-01-25",
		messages,
	});
	const requests: ModelProviderRequest[] = [];
	const completions: ModelCompletion[] = [];
	const provider: ModelProviderPort = {
		async complete(request) {
			requests.push(request);
			const completion = await recordedModelProvider.complete(request);
			completions.push(completion);
			return completion;
		},
	};

	const execution = await executeProductionSteps(preparedEvidence, {
		main_story_write: provider,
		main_story_copyedit: provider,
		announcements_write: provider,
		announcements_copyedit: provider,
	});

	expect(execution.observations.map(({ request }) => request.productionStep)).toEqual(
		PRODUCTION_MODEL_STEPS,
	);
	for (const [index, observation] of execution.observations.entries()) {
		expect(observation.request).toBe(requests[index]);
		expect(observation.completion).toBe(completions[index]);
		expect(execution.steps[index]?.production_step).toBe(observation.request.productionStep);
	}
	expect(execution.steps[1]?.output).toBe(execution.products.mainStory);
	expect(execution.steps[3]?.output).toBe(execution.products.announcements);
});
