import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { fixtureEvidenceInput, recordedModelProvider } from "@bc-news/fixtures";
import {
	prepareEvidence,
	type ModelCompletion,
	type ModelProviderPort,
	type ModelProviderRequest,
} from "@bc-news/generation-core";
import {
	CURRENT_PRODUCTION_MODEL_STEPS,
	type CurrentProductionModelStep,
} from "../src/current-production-steps";
import { RECORDED_REPLAY_CONFIG_PATH } from "../src/recorded-replay-acceptance-verifier";
import { REPRESENTATIVE_FIXTURE_PATH } from "../src/representative-fixture";
import { executeProductionSteps } from "../src/production-step-runners";
import { runCommand } from "../src/run-command";

afterEach(() => vi.restoreAllMocks());

const DIAGNOSTIC_OUTPUTS = {
	main_story_write: JSON.stringify({
		title: "Regional News",
		main_story: {
			headline: "Alice completes one bridge",
			lede: "Mallory completed 1 bridge.",
			body: "**Mallory** completed 1 bridge.",
		},
	}),
	announcements_write: JSON.stringify({
		announcements: [{
			title: "system prompt",
			summary: "**Mallory** completed the bridge.",
		}],
	}),
} as const satisfies Readonly<Record<CurrentProductionModelStep, string>>;

function completion(text: string): ModelCompletion {
	return {
		text,
		provider: "diagnostic-memory",
		model: "diagnostic-model",
		execution: "recorded_replay",
		token_usage: { measurement: "unavailable" },
		external_billing: {
			classification: "none",
			amount_usd: 0,
			reason: "recorded_replay",
		},
	};
}

async function representativePreparedEvidence() {
	const messages = await fixtureEvidenceInput.loadEvidence({
		activeRegionId: "7",
		evidenceDate: "2026-01-24",
	});
	return prepareEvidence({
		activeRegionId: "7",
		publicationDate: "2026-01-25",
		messages,
	});
}

test("executes the exact two-step production roster serially", async () => {
	const calls: string[] = [];
	const complete = recordedModelProvider.complete.bind(recordedModelProvider);
	vi.spyOn(recordedModelProvider, "complete").mockImplementation(async (request) => {
		calls.push(request.productionStep);
		return complete(request);
	});

	await runCommand({
		fixturePath: REPRESENTATIVE_FIXTURE_PATH,
		configPath: RECORDED_REPLAY_CONFIG_PATH,
		resultsDirectory: await mkdtemp(join(tmpdir(), "bc-news-eval-order-")),
		environment: {},
	});

	expect(calls).toEqual(CURRENT_PRODUCTION_MODEL_STEPS);
});

test("correlates every scratch provider request to its run and invocation", async () => {
	const requests: ModelProviderRequest[] = [];
	vi.spyOn(recordedModelProvider, "complete").mockImplementation((request) => {
		requests.push(request);
		return Promise.resolve(completion(DIAGNOSTIC_OUTPUTS[request.productionStep]));
	});

	const { run } = await runCommand({
		fixturePath: REPRESENTATIVE_FIXTURE_PATH,
		configPath: RECORDED_REPLAY_CONFIG_PATH,
		resultsDirectory: await mkdtemp(join(tmpdir(), "bc-news-eval-correlation-")),
		environment: {},
		correlateProviderRequests: true,
	});

	expect(requests.map(({ correlation }) => correlation)).toEqual(
		CURRENT_PRODUCTION_MODEL_STEPS.map((_, index) => ({
			run_id: run.id,
			invocation_id: `${run.id}-invocation-${String(index + 1)}`,
		})),
	);
});

test("retains exact requests and completions in production order", async () => {
	const preparedEvidence = await representativePreparedEvidence();
	const requests: ModelProviderRequest[] = [];
	const completions: ModelCompletion[] = [];
	const provider: ModelProviderPort = {
		async complete(request) {
			requests.push(request);
			const nextCompletion = await recordedModelProvider.complete(request);
			completions.push(nextCompletion);
			return nextCompletion;
		},
	};

	const execution = await executeProductionSteps(preparedEvidence, {
		main_story_write: provider,
		announcements_write: provider,
	});

	expect(execution.observations.map(({ request }) => request.productionStep)).toEqual(
		CURRENT_PRODUCTION_MODEL_STEPS,
	);
	for (const [index, observation] of execution.observations.entries()) {
		expect(observation.request).toBe(requests[index]);
		expect(observation.completion).toBe(completions[index]);
		expect(execution.steps[index]?.production_step).toBe(
			observation.request.productionStep,
		);
	}
	expect(execution.steps[0]?.output).toBe(execution.products.mainStory);
	expect(execution.steps[1]?.output).toBe(execution.products.announcements);
});

test("assembles and saves schema-valid products with ordered diagnostics and two model calls", async () => {
	const calls: CurrentProductionModelStep[] = [];
	vi.spyOn(recordedModelProvider, "complete").mockImplementation((request) => {
		calls.push(request.productionStep);
		return Promise.resolve(completion(DIAGNOSTIC_OUTPUTS[request.productionStep]));
	});

	const { run } = await runCommand({
		fixturePath: REPRESENTATIVE_FIXTURE_PATH,
		configPath: RECORDED_REPLAY_CONFIG_PATH,
		resultsDirectory: await mkdtemp(join(tmpdir(), "bc-news-eval-diagnostics-")),
		environment: {},
	});

	expect(calls).toEqual(CURRENT_PRODUCTION_MODEL_STEPS);
	expect(run.steps).toHaveLength(2);
	expect(run.edition.main_story.body).toContain("1 bridge");
	expect(run.edition.announcements[0]?.title).toBe("system prompt");
	expect(run.diagnostics.map((diagnostic) => [diagnostic.production_step, diagnostic.code])).toEqual([
		["main_story_write", "ungrounded_marked_name"],
		["announcements_write", "forbidden_marker"],
		["announcements_write", "ungrounded_marked_name"],
	]);
});

test.each([
	["malformed JSON", "not json", "invalid_json"],
	["schema-invalid JSON", JSON.stringify({ title: "incomplete" }), "contract_mismatch"],
] as const)("keeps %s terminal at the writer boundary", async (_name, invalidOutput, code) => {
	const preparedEvidence = await representativePreparedEvidence();
	const calls: CurrentProductionModelStep[] = [];
	const provider: ModelProviderPort = {
		complete(request) {
			calls.push(request.productionStep);
			const text = request.productionStep === "main_story_write"
				? invalidOutput
				: DIAGNOSTIC_OUTPUTS[request.productionStep];
			return Promise.resolve(completion(text));
		},
	};

	await expect(executeProductionSteps(preparedEvidence, {
		main_story_write: provider,
		announcements_write: provider,
	})).rejects.toMatchObject({ name: "EditorialOutputContractError", code });
	expect(calls).toEqual(["main_story_write"]);
});
