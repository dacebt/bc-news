import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PRODUCTION_MODEL_STEPS } from "@bc-news/generation-core";
import { expect, test } from "vitest";
import {
	EvalConfigSchema,
	LiveBenchmarkConfigSchema,
	loadLiveBenchmarkConfig,
} from "../src/config";
import { BenchmarkRunSchema } from "../src/evaluation-artifact";
import { verifyEvaluationBenchmarkContinuation } from "../src/evaluation-benchmark-verifier";
import { clone, temporaryRoot } from "./evaluation-artifact-test-support";

// This integration exercise exceeds Vitest's five-second default when the
// workspace packages execute in parallel; the wider deadline is not a retry.
const WORKSPACE_PARALLELISM_TIMEOUT_MS = 10_000;

function hostedConfiguration(modelPrefix: string) {
	return {
		production_steps: Object.fromEntries(PRODUCTION_MODEL_STEPS.map((step) => [step, {
			adapter: "openai_compatible_hosted",
			provider: "repository_loopback",
			model: `${modelPrefix}/${step}`,
			billing: { method: "calculated", input_usd_per_million_tokens: 0, output_usd_per_million_tokens: 0, pricing_reference: "repository test" },
		}])),
	};
}

test("retains retries and continues independent tracks and later trials", async () => {
	const root = await temporaryRoot("bc-news-benchmark-continuation-test-");
	await verifyEvaluationBenchmarkContinuation(root);
	const [artifactName] = await readdir(join(root, "results"));
	const benchmark = BenchmarkRunSchema.parse(JSON.parse(await readFile(join(root, "results", artifactName!), "utf8")) as unknown);
	expect(benchmark.version).toBe(7);
	if (benchmark.version !== 7) throw new Error("expected version 7 benchmark");

	const prematureExhaustion = clone(benchmark);
	const exhaustedTrial = prematureExhaustion.trials.find(({ subject_outcome }) => subject_outcome === "infrastructure_incomplete");
	if (exhaustedTrial === undefined) throw new Error("expected provider-exhausted trial");
	const secondFailureIndex = exhaustedTrial.invocations.findIndex(({ production_step }, index) => production_step === "main_story_write" && index > 0);
	if (secondFailureIndex < 0) throw new Error("expected retained retry failure");
	exhaustedTrial.invocations.splice(secondFailureIndex, 1);
	for (const [index, invocation] of exhaustedTrial.invocations.entries()) invocation.ordinal = index + 1;
	expect(BenchmarkRunSchema.safeParse(prematureExhaustion).success).toBe(false);

	const impossibleChronology = clone(benchmark);
	impossibleChronology.trials[0]!.started_at = new Date(Date.parse(impossibleChronology.started_at) - 1_000).toISOString();
	expect(BenchmarkRunSchema.safeParse(impossibleChronology).success).toBe(false);

	const wrongTrialInvocationIdentity = clone(benchmark);
	wrongTrialInvocationIdentity.trials[2]!.invocations[0]!.config_identity = wrongTrialInvocationIdentity.trials[3]!.config_identity;
	const identityResult = BenchmarkRunSchema.safeParse(wrongTrialInvocationIdentity);
	expect(identityResult.success).toBe(false);
	if (!identityResult.success) {
		expect(identityResult.error.issues.some(({ path }) => path.join(".") === "trials.2.invocations.0.config_identity")).toBe(true);
	}
}, WORKSPACE_PARALLELISM_TIMEOUT_MS);

test("rejects ambiguous or unbounded benchmark declarations", () => {
	const configuration = hostedConfiguration("test/configuration");
	expect(LiveBenchmarkConfigSchema.safeParse({ configurations: [configuration, configuration], repetition_count: 1, transport_retry_limit: 1 }).success).toBe(false);
	expect(LiveBenchmarkConfigSchema.safeParse({ configurations: [configuration], repetition_count: 0, transport_retry_limit: 1 }).success).toBe(false);
	expect(LiveBenchmarkConfigSchema.safeParse({ configurations: [configuration], repetition_count: 1, transport_retry_limit: 4 }).success).toBe(false);
	expect(LiveBenchmarkConfigSchema.safeParse({ configurations: [configuration], repetition_count: 1, transport_retry_limit: 1, extra: true }).success).toBe(false);
});

test("retains independent temperature choices for every LM Studio production step", () => {
	type LocalConfiguration = {
		adapter: "lmstudio";
		model: string;
		reasoning_effort: "provider_default";
		temperature?: number;
	};
	const localConfiguration = () => ({
		production_steps: Object.fromEntries(PRODUCTION_MODEL_STEPS.map((step): [typeof step, LocalConfiguration] => [step, {
			adapter: "lmstudio",
			model: `local/${step}`,
			reasoning_effort: "provider_default",
		}])) as Record<(typeof PRODUCTION_MODEL_STEPS)[number], LocalConfiguration>,
	});
	const independent = localConfiguration();
	independent.production_steps.main_story_write = {
		...independent.production_steps.main_story_write,
		temperature: 0.7,
	};
	independent.production_steps.main_story_copyedit = {
		...independent.production_steps.main_story_copyedit,
		temperature: 0.2,
	};
	const parsed = EvalConfigSchema.parse(independent);
	expect(parsed.production_steps.main_story_write).toHaveProperty("temperature", 0.7);
	expect(parsed.production_steps.main_story_copyedit).toHaveProperty("temperature", 0.2);
	expect(parsed.production_steps.announcements_write).not.toHaveProperty("temperature");

	for (const invalidStep of [
		{ ...independent.production_steps.main_story_write, temperature: 2.1 },
		{ ...independent.production_steps.main_story_write, sampling: { temperature: 0, top_p: 1, top_k: 1 } },
		{ ...independent.production_steps.main_story_write, top_p: 1 },
		{ ...independent.production_steps.main_story_write, top_k: 1 },
	]) {
		expect(EvalConfigSchema.safeParse({
			production_steps: { ...independent.production_steps, main_story_write: invalidStep },
		}).success).toBe(false);
	}
});

test("rejects recorded adapters before serial artifact creation", async () => {
	const root = await temporaryRoot("bc-news-benchmark-config-test-");
	const path = join(root, "recorded-benchmark.json");
	const configuration = {
		production_steps: Object.fromEntries(PRODUCTION_MODEL_STEPS.map((step) => [
			step,
			step === "main_story_write"
				? { adapter: "recorded" }
				: hostedConfiguration("test/configuration").production_steps[step],
		])),
	};
	await writeFile(path, `${JSON.stringify({ configurations: [configuration], repetition_count: 1, transport_retry_limit: 1 })}\n`, "utf8");
	await expect(loadLiveBenchmarkConfig(path)).rejects.toMatchObject({ code: "recorded_adapter_rejected_for_live_evaluation" });
});
