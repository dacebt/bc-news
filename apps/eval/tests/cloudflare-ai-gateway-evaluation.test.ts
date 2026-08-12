import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { PRODUCTION_MODEL_STEPS, type ProductionModelStep } from "@bc-news/generation-core";
import { RecordedModelResponseSchema } from "@bc-news/fixtures";
import { evaluateBenchmarkCommand } from "../src/evaluation-benchmark-command";
import { V8BenchmarkRunSchema, evaluationConfigIdentity } from "../src/evaluation-artifact";
import { REPRESENTATIVE_FIXTURE_PATH } from "../src/representative-fixture";

const RESPONSE_DIRECTORY = new URL("../../../packages/fixtures/model-responses/", import.meta.url).pathname;
const TEST_PROVENANCE = { repository: "bc-news" as const, commit_sha: "8".repeat(40), dirty: false as const };

afterEach(() => vi.restoreAllMocks());

async function outputs(): Promise<Record<ProductionModelStep, string>> {
	return Object.fromEntries(await Promise.all(PRODUCTION_MODEL_STEPS.map(async (step) => {
		const candidate = JSON.parse(await readFile(join(RESPONSE_DIRECTORY, `${step}.json`), "utf8")) as unknown;
		return [step, RecordedModelResponseSchema.parse(candidate).text];
	}))) as Record<ProductionModelStep, string>;
}

function configuration(
	author: "openai" | "anthropic",
	gateway: { selection: "named"; id: string } | { selection: "account_default" } = { selection: "named", id: "bc-news-evaluation" },
) {
	return {
		production_steps: Object.fromEntries(PRODUCTION_MODEL_STEPS.map((step) => [step, {
			adapter: "cloudflare_ai_gateway",
				gateway,
			model: `${author}/${step}`,
			}])) as Record<ProductionModelStep, object>,
	};
}

test("runs two hosted provider families through the Gateway contract and retains v8 provenance", async () => {
	const root = await mkdtemp(join(tmpdir(), "bc-news-cloudflare-ai-gateway-evaluation-"));
	try {
		const configPath = join(root, "benchmark.config.json");
		const resultsDirectory = join(root, "results");
		await writeFile(configPath, `${JSON.stringify({
				configurations: [configuration("openai"), configuration("anthropic")],
			repetition_count: 1,
			transport_retry_limit: 0,
		}, null, 2)}\n`, "utf8");
		const retainedOutputs = await outputs();
		let ordinal = 0;
		const fetchCall = vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
			const body = typeof init?.body === "string" ? JSON.parse(init.body) as { model: string } : undefined;
			if (body === undefined) throw new Error("Expected Gateway request body");
			const step = body.model.split("/")[1] as ProductionModelStep;
			ordinal += 1;
			return Promise.resolve(new Response(JSON.stringify({
				id: `provider-response-${String(ordinal)}`,
				object: "chat.completion",
				model: body.model,
				choices: [{ index: 0, message: { role: "assistant", content: retainedOutputs[step], refusal: null }, finish_reason: "stop", logprobs: null }],
				usage: { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 },
			}), { headers: { "content-type": "application/json", "cf-aig-log-id": `gateway-log-${String(ordinal)}` } }));
		});

		const result = await evaluateBenchmarkCommand({
			fixturePath: REPRESENTATIVE_FIXTURE_PATH,
			configPath,
			resultsDirectory,
			environment: { CLOUDFLARE_ACCOUNT_ID: "account-id", CLOUDFLARE_API_TOKEN: "sentinel" },
			sourceProvenance: TEST_PROVENANCE,
		});

		expect(result.benchmark.version).toBe(8);
		if (result.benchmark.version !== 8) throw new Error("Expected V8 Gateway benchmark");
		expect(V8BenchmarkRunSchema.safeParse(result.benchmark).success).toBe(true);
			expect(result.benchmark.trials).toHaveLength(2);
		expect(result.benchmark.trials.every(({ subject_outcome }) => subject_outcome === "completed")).toBe(true);
		expect(result.benchmark.trials.map((trial) => [...new Set(trial.invocations
			.filter((invocation) => invocation.transport === "succeeded")
				.map((invocation) => invocation.completion.provider))])).toEqual([["openai"], ["anthropic"]]);
			const captured = result.benchmark.gateway_requests.filter((record) => record.state === "captured");
			expect(captured).toHaveLength(8);
			expect(new Set(captured.map(({ provenance }) => provenance.gateway_log_id)).size).toBe(8);
		expect(captured.every(({ provenance }) => provenance.policy.max_attempts === 1
			&& provenance.policy.log_payload === false
			&& provenance.correlation.run_id === result.benchmark.id)).toBe(true);
			expect(fetchCall).toHaveBeenCalledTimes(8);
		for (const [, init] of fetchCall.mock.calls) {
			expect(init?.headers).toEqual(expect.objectContaining({
				"cf-aig-skip-cache": "true",
				"cf-aig-collect-log-payload": "false",
				"cf-aig-max-attempts": "1",
				}));
			}

			const named = configuration("openai");
			const accountDefault = configuration("openai", { selection: "account_default" });
			const configurations = [named, accountDefault].map((config) => ({
				identity: evaluationConfigIdentity(config),
				config,
			}));
			expect(V8BenchmarkRunSchema.safeParse({
				...result.benchmark,
				lifecycle: "running",
				completed_at: null,
				declaration: { ...result.benchmark.declaration, configurations },
				trial_roster: configurations.map(({ identity }, index) => ({
					trial_id: `gateway-selection-${String(index + 1)}`,
					config_identity: identity,
					repetition: 1,
				})),
				trials: [],
				runtime_evidence: [],
				gateway_requests: [],
				outcome_counts: { completed: 0, parse_rejected: 0, contract_rejected: 0, infrastructure_incomplete: 0 },
				harness_outcome: "pending",
			}).success).toBe(true);
		} finally {
		await rm(root, { recursive: true, force: true });
	}
}, 15_000);
