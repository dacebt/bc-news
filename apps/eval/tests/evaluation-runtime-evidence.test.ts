import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	PRODUCTION_MODEL_STEPS,
	type ModelCompletion,
	type ModelProviderPort,
	type ModelRuntimeEvidence,
	type ProductionModelStep,
} from "@bc-news/generation-core";
import { RecordedModelResponseSchema } from "@bc-news/fixtures";
import { afterEach, expect, test, vi } from "vitest";
import { loadBenchmarkRun } from "../src/evaluation-artifact-reader";
import { summarizeBenchmarkRun } from "../src/evaluation-browse-report";
import { evaluateTrialCommand } from "../src/evaluation-trial-command";
import { requireRuntimeEvidence } from "../src/evaluation-trial-execution";
import { REPRESENTATIVE_FIXTURE_PATH } from "../src/representative-fixture";
import { TEST_SOURCE_PROVENANCE, temporaryRoot } from "./evaluation-artifact-test-support";

const providerOverride = vi.hoisted(() => ({
	current: null as Record<ProductionModelStep, ModelProviderPort> | null,
}));

vi.mock("../src/evaluation-trial-support", async (importOriginal) => {
	const original = await importOriginal<typeof import("../src/evaluation-trial-support")>();
	return {
		...original,
		providersFor: (...args: Parameters<typeof original.providersFor>) => providerOverride.current ?? original.providersFor(...args),
	};
});

afterEach(() => { providerOverride.current = null; });

const unknownString = { state: "unknown" as const, reason: "not_reported" as const };
const providerControlledString = { state: "externally_controlled" as const, reason: "provider_controlled" as const };
const providerControlledInteger = { state: "externally_controlled" as const, reason: "provider_controlled" as const };
const providerControlledMeasurement = { state: "externally_controlled" as const, reason: "provider_controlled" as const };
const providerControlledBoolean = { state: "externally_controlled" as const, reason: "provider_controlled" as const };

function hostedRuntimeEvidence(requestedModel: string): ModelRuntimeEvidence {
	const identity = {
		requested_identity: { state: "observed" as const, value: requestedModel },
		identifier: providerControlledString,
		model_key: providerControlledString,
		path: providerControlledString,
		display_name: providerControlledString,
		format: providerControlledString,
		instance_reference: providerControlledString,
		size_bytes: providerControlledInteger,
		architecture: providerControlledString,
		parameter_count_description: providerControlledString,
		quantization_name: providerControlledString,
		quantization_bits: providerControlledMeasurement,
		vision_capable: providerControlledBoolean,
		trained_for_tool_use: providerControlledBoolean,
	};
	return {
		execution_context: {
			client_sdk_release: { state: "unknown", reason: "not_applicable" },
			provider_runtime_identity: unknownString,
			provider_runtime_version: providerControlledString,
			provider_runtime_build: providerControlledInteger,
			provider_service_tier: unknownString,
			selected_model: identity,
			response_model: { ...identity, identifier: { state: "observed", value: requestedModel } },
			context_length: { state: "externally_controlled", reason: "provider_controlled" },
			requested_reasoning_posture: { state: "observed", value: "provider_default" },
			effective_reasoning_setting: providerControlledString,
			speculative_draft_model_identity: unknownString,
		},
		prediction_observation: {
			provider_response_id: unknownString,
			stop_reason: unknownString,
			time_to_first_token_ms: unknownString,
			total_time_ms: unknownString,
			tokens_per_second: unknownString,
			speculative_total_tokens: unknownString,
			speculative_accepted_tokens: unknownString,
			speculative_rejected_tokens: unknownString,
			speculative_ignored_tokens: unknownString,
			reasoning_content_present: { state: "unknown", reason: "not_reported" },
		},
	};
}

async function recordedCompletion(step: ProductionModelStep, includeRuntimeEvidence = true): Promise<ModelCompletion> {
	const responsePath = new URL(`../../../packages/fixtures/model-responses/${step}.json`, import.meta.url);
	const response = RecordedModelResponseSchema.parse(JSON.parse(await readFile(responsePath, "utf8")) as unknown);
	const model = `evidence-test/${step}`;
	return {
		text: response.text,
		provider: "evidence-test",
		model,
		execution: "hosted_inference",
		token_usage: { measurement: "reported", input_tokens: 1, output_tokens: 1, total_tokens: 2 },
		external_billing: { classification: "calculated", amount_usd: 0, pricing_reference: "evidence failure test" },
		...(includeRuntimeEvidence ? { runtime_evidence: hostedRuntimeEvidence(model) } : {}),
	};
}

test("classifies a successful live completion without runtime evidence as an evaluator evidence failure", () => {
	expect(() => requireRuntimeEvidence({
		text: "completion",
		provider: "uninstrumented-provider",
		model: "uninstrumented-model",
		execution: "hosted_inference",
		token_usage: { measurement: "unavailable" },
		external_billing: { classification: "unavailable", reason: "provider_did_not_report_cost" },
	}, "main_story_write")).toThrow(expect.objectContaining({
		code: "evaluator_runtime_evidence_missing",
	}));
});

test("keeps a provider success without runtime evidence pending and leaves the benchmark running", async () => {
	const completions = Object.fromEntries(await Promise.all(PRODUCTION_MODEL_STEPS.map(async (step) => [
		step,
		await recordedCompletion(step, step !== "main_story_write"),
	]))) as Record<ProductionModelStep, ModelCompletion>;
	const completionCalls = {
		main_story_write: vi.fn(() => Promise.resolve(completions.main_story_write)),
		announcements_write: vi.fn(() => Promise.resolve(completions.announcements_write)),
	};
	providerOverride.current = {
		main_story_write: { complete: completionCalls.main_story_write },
		announcements_write: { complete: completionCalls.announcements_write },
	};

	const root = await temporaryRoot("bc-news-runtime-evidence-failure-");
	const resultsDirectory = join(root, "results");
	const configPath = join(root, "config.json");
	const configuration = {
		production_steps: Object.fromEntries(PRODUCTION_MODEL_STEPS.map((step) => [step, {
			adapter: "openai_compatible_hosted",
			provider: "evidence-test",
			model: `evidence-test/${step}`,
			billing: {
				method: "calculated",
				input_usd_per_million_tokens: 0,
				output_usd_per_million_tokens: 0,
				pricing_reference: "evidence failure test",
			},
		}])),
	};
	await writeFile(configPath, `${JSON.stringify(configuration)}\n`, "utf8");
	const snapshots: unknown[] = [];
	await expect(evaluateTrialCommand({
		fixturePath: REPRESENTATIVE_FIXTURE_PATH,
		configPath,
		resultsDirectory,
		sourceProvenance: TEST_SOURCE_PROVENANCE,
		artifactObserver: (artifact) => { snapshots.push(structuredClone(artifact)); },
	})).rejects.toMatchObject({ code: "evaluator_runtime_evidence_missing" });

	const [artifactName] = await readdir(resultsDirectory);
	if (artifactName === undefined) throw new Error("Expected retained benchmark artifact");
	const benchmarkId = artifactName.replace(/\.json$/u, "");
	const retained = await loadBenchmarkRun(benchmarkId, resultsDirectory);
	expect(retained.version).toBe(9);
	if (retained.version !== 9) throw new Error("Expected V9 benchmark artifact");
	const mainInvocation = retained.trials[0]?.invocations.find(({ production_step }) => production_step === "main_story_write");
	const mainEvidence = retained.runtime_evidence.find(({ production_step }) => production_step === "main_story_write");
	expect(mainInvocation).toMatchObject({ transport: "in_flight", parse: { state: "pending" } });
	expect(mainEvidence).toMatchObject({ state: "pending" });
	expect(retained).toMatchObject({ lifecycle: "running", completed_at: null, harness_outcome: "pending" });
	expect(retained.runtime_evidence).not.toContainEqual(expect.objectContaining({ reason: "transport_failed", production_step: "main_story_write" }));
	expect(completionCalls.main_story_write).toHaveBeenCalledOnce();
	expect(completionCalls.announcements_write).toHaveBeenCalledOnce();
	expect(summarizeBenchmarkRun(retained)).toMatchObject({ lifecycle: "running", harness_outcome: "pending" });
	expect(snapshots.at(-1)).toEqual(retained);
});
