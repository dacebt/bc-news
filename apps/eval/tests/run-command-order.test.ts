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
	type ProductionModelStep,
} from "@bc-news/generation-core";
import { RECORDED_REPLAY_CONFIG_PATH } from "../src/recorded-replay-acceptance-verifier";
import { REPRESENTATIVE_FIXTURE_PATH } from "../src/representative-fixture";
import { executeProductionSteps } from "../src/production-step-runners";
import { runCommand } from "../src/run-command";

afterEach(() => vi.restoreAllMocks());

const DIAGNOSTIC_OUTPUTS = {
	main_story_write: JSON.stringify({
		title: "Regional News",
		subtitle: "Bridge report",
		main_story: {
			headline: "Alice completes one bridge",
			lede: "Alice completed 1 bridge.",
			body: "**Alice** completed 1 bridge.",
		},
	}),
	main_story_copyedit: JSON.stringify({
		title: "Regional News",
		subtitle: "Bridge report",
		main_story: {
			headline: "Alice completes two bridges",
			lede: "Alice completed 2 bridges — quickly.",
			body: "**Alice** completed 2 bridges — quickly.",
		},
	}),
	announcements_write: JSON.stringify({
		announcements: [{ title: "Bridge complete", summary: "Alice completed the bridge." }],
	}),
	announcements_copyedit: JSON.stringify({
		announcements: [{
			id: "announcement-2",
			title: "system prompt",
			summary: "**Mallory** completed the bridge.",
		}],
	}),
} as const satisfies Readonly<Record<string, string>>;

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

test("executes the exact dependent four-step production roster serially", async () => {
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

	expect(calls).toEqual(PRODUCTION_MODEL_STEPS);
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

	expect(requests.map(({ correlation }) => correlation)).toEqual(PRODUCTION_MODEL_STEPS.map((_, index) => ({
		run_id: run.id,
		invocation_id: `${run.id}-invocation-${String(index + 1)}`,
	})));
});

test("retains exact requests and completions in production order", async () => {
	const preparedEvidence = await representativePreparedEvidence();
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

test("assembles and saves schema-valid products with ordered diagnostics and four model calls", async () => {
	const calls: ProductionModelStep[] = [];
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

	expect(calls).toEqual(PRODUCTION_MODEL_STEPS);
	expect(run.steps).toHaveLength(4);
	expect(run.edition.main_story.body).toContain("2 bridges — quickly");
	expect(run.edition.announcements[0]?.title).toBe("system prompt");
	expect(run.diagnostics.map((diagnostic) => [diagnostic.production_step, diagnostic.code]))
		.toEqual(expect.arrayContaining([
			["main_story_copyedit", "numeric_literal"],
			["main_story_copyedit", "forbidden_marker"],
			["announcements_copyedit", "announcement_identity"],
			["announcements_copyedit", "forbidden_marker"],
			["announcements_copyedit", "ungrounded_marked_name"],
		]));
	const diagnosticStepIndexes = run.diagnostics.map((diagnostic) =>
		PRODUCTION_MODEL_STEPS.indexOf(diagnostic.production_step)
	);
	expect(diagnosticStepIndexes).toEqual([...diagnosticStepIndexes].sort((left, right) => left - right));
});

test.each([
	["malformed JSON", "not json", "invalid_json"],
	["schema-invalid JSON", JSON.stringify({ title: "incomplete" }), "contract_mismatch"],
] as const)("keeps %s terminal at the copyedit boundary", async (_name, invalidOutput, code) => {
	const preparedEvidence = await representativePreparedEvidence();
	const calls: ProductionModelStep[] = [];
	const provider: ModelProviderPort = {
		complete(request) {
			calls.push(request.productionStep);
			const text = request.productionStep === "main_story_copyedit"
				? invalidOutput
				: DIAGNOSTIC_OUTPUTS[request.productionStep];
			return Promise.resolve(completion(text));
		},
	};

	await expect(executeProductionSteps(preparedEvidence, {
		main_story_write: provider,
		main_story_copyedit: provider,
		announcements_write: provider,
		announcements_copyedit: provider,
	})).rejects.toMatchObject({ name: "EditorialOutputContractError", code });
	expect(calls).toEqual(["main_story_write", "main_story_copyedit"]);
});
