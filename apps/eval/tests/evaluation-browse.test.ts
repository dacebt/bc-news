import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PRODUCTION_MODEL_STEPS } from "@bc-news/generation-core";
import { expect, test } from "vitest";
import { evaluationConfigIdentity, type BenchmarkRun } from "../src/evaluation-artifact";
import { verifyEvaluationBenchmarkBrowsing } from "../src/evaluation-browse-verifier";
import { summarizeBenchmarkRun } from "../src/evaluation-browse-report";
import { listBenchmarkRuns, loadBenchmarkRun } from "../src/evaluation-artifact-reader";
import { compareBenchmarkRuns } from "../src/evaluation-comparison";
import { V4BenchmarkRunSchema, V4EvalConfigSchema } from "../src/evaluation-artifact-v4";
import { clone, controlledEvaluation, temporaryRoot } from "./evaluation-artifact-test-support";

const RESPONSE_DIRECTORY = new URL("../../../packages/fixtures/model-responses/", import.meta.url).pathname;

function first<T>(items: readonly T[], label: string): T {
	const item = items[0];
	if (item === undefined) throw new Error(`Expected ${label}`);
	return item;
}

async function finalProductRejectedMainStory(): Promise<string> {
	const retained = JSON.parse(
		await readFile(join(RESPONSE_DIRECTORY, "main_story_copyedit.json"), "utf8"),
	) as { text: string };
	const output = JSON.parse(retained.text) as {
		main_story: { body: string };
	};
	output.main_story.body = `${output.main_story.body} system prompt`;
	return JSON.stringify(output);
}

test("browses retained benchmark evidence through the CLI boundary", async () => {
	await verifyEvaluationBenchmarkBrowsing();
});

test("distinguishes an absent benchmark directory from a missing run", async () => {
	const root = await temporaryRoot("bc-news-evaluation-browse-reader-");
	expect(await listBenchmarkRuns(join(root, "absent"))).toEqual([]);
	await expect(loadBenchmarkRun("missing-run", join(root, "absent"))).rejects.toMatchObject({
		code: "benchmark_not_found",
	});
});

test("summarizes completed products with retained diagnostics", async () => {
	const { result } = await controlledEvaluation(undefined, 1, {
		main_story_copyedit: await finalProductRejectedMainStory(),
	});
	expect(result.benchmark.trials[0]?.tracks.main_story.subject_outcome).toBe("completed");
	expect(result.benchmark.trials[0]?.tracks.main_story.findings).toEqual(expect.arrayContaining([
		expect.objectContaining({ kind: "final_product", code: "forbidden_marker" }),
	]));
	const summary = summarizeBenchmarkRun(result.benchmark);
	expect(result.benchmark.version).toBe(5);
	expect(summary.configurations[0]?.lm_studio_sampling_posture).toBe("not_applicable");
	expect(summary.products).toEqual(expect.arrayContaining([
		expect.objectContaining({ track: "main_story", track_outcome: "completed", diagnostic_count: 5 }),
	]));
	expect(summary.diagnostic_kind_counts).toMatchObject({ preservation: 2, final_product: 3 });
});

test("compares retained diagnostics as behavior", async () => {
	const baseline = await controlledEvaluation();
	const diagnostic = await controlledEvaluation(undefined, 1, {
		main_story_copyedit: await finalProductRejectedMainStory(),
	});
	const comparison = compareBenchmarkRuns(baseline.result.benchmark, diagnostic.result.benchmark);
	expect(comparison.behavioralDifferences).toEqual(expect.arrayContaining([
		expect.stringContaining("tracks.main_story.findings"),
	]));
});

test("keeps LM Studio sampling configuration and posture in comparison context", async () => {
	const retainedStates: BenchmarkRun[] = [];
	await controlledEvaluation((artifact) => { retainedStates.push(artifact); });
	const initialRetainedState = first(retainedStates, "initial retained benchmark state");
	const explicit = clone(V4BenchmarkRunSchema.parse({
		...initialRetainedState,
		version: 4,
		outcome_counts: {
			...initialRetainedState.outcome_counts,
			preservation_rejected: 0,
			final_product_rejected: 0,
		},
	}));
	const declaration = first(explicit.declaration.configurations, "one declared configuration");
	declaration.config = V4EvalConfigSchema.parse({
		production_steps: Object.fromEntries(PRODUCTION_MODEL_STEPS.map((step) => [step, {
			adapter: "lmstudio",
			model: `local/${step}`,
			reasoning_effort: "provider_default",
			sampling: { temperature: 0, top_p: 1, top_k: 1 },
		}])),
	});
	const explicitIdentity = evaluationConfigIdentity(declaration.config);
	declaration.identity = explicitIdentity;
	first(explicit.trial_roster, "one trial roster member").config_identity = explicitIdentity;
	const explicitTrial = first(explicit.trials, "one evaluation trial");
	explicitTrial.config_identity = explicitIdentity;
	for (const invocation of explicitTrial.invocations) {
		invocation.config_identity = explicitIdentity;
		if (invocation.transport !== "succeeded") continue;
		invocation.completion.execution = "local_inference";
		invocation.completion.provider = "lmstudio";
		invocation.completion.external_billing = { classification: "none", amount_usd: 0, reason: "local_inference" };
	}
	const parsedExplicit = V4BenchmarkRunSchema.parse(explicit);

	const providerDefault = clone(parsedExplicit);
	const providerDefaultDeclaration = first(providerDefault.declaration.configurations, "one provider-default declaration");
	for (const config of Object.values(providerDefaultDeclaration.config.production_steps)) {
		if (config.adapter === "lmstudio") delete config.sampling;
	}
	const providerDefaultIdentity = evaluationConfigIdentity(providerDefaultDeclaration.config);
	providerDefaultDeclaration.identity = providerDefaultIdentity;
	first(providerDefault.trial_roster, "one provider-default roster member").config_identity = providerDefaultIdentity;
	const providerDefaultTrial = first(providerDefault.trials, "one provider-default trial");
	providerDefaultTrial.config_identity = providerDefaultIdentity;
	for (const invocation of providerDefaultTrial.invocations) invocation.config_identity = providerDefaultIdentity;
	const parsedProviderDefault = V4BenchmarkRunSchema.parse(providerDefault);

	const comparison = compareBenchmarkRuns(parsedExplicit, parsedProviderDefault);
	expect(comparison.contextDifferences).toEqual(expect.arrayContaining([
		expect.stringContaining("sampling"),
		expect.stringContaining("lm_studio_sampling_postures"),
	]));
	expect(comparison.behavioralDifferences).toEqual([]);
});
