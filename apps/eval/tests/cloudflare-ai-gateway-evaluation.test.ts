import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { PRODUCTION_MODEL_STEPS, type ProductionModelStep } from "@bc-news/generation-core";
import { RecordedModelResponseSchema } from "@bc-news/fixtures";
import type { CloudflareHostedModelId } from "@bc-news/model-adapters";
import { evaluateBenchmarkCommand } from "../src/evaluation-benchmark-command";
import { V8BenchmarkRunSchema, evaluationConfigIdentity } from "../src/evaluation-artifact";
import { formatBenchmarkRunReport } from "../src/benchmark-run-report";
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
	model: CloudflareHostedModelId,
	gateway?: { selection: "named"; id: string },
) {
	return {
		production_steps: Object.fromEntries(PRODUCTION_MODEL_STEPS.map((step) => [step, {
			adapter: "cloudflare_ai_gateway",
			...(gateway === undefined ? {} : { gateway }),
			model,
		}])) as Record<ProductionModelStep, object>,
	};
}

test("runs two hosted provider families through the Gateway contract and retains v8 provenance", async () => {
	const root = await mkdtemp(join(tmpdir(), "bc-news-cloudflare-ai-gateway-evaluation-"));
	try {
		const configPath = join(root, "benchmark.config.json");
		const resultsDirectory = join(root, "results");
		await writeFile(configPath, `${JSON.stringify({
			configurations: [configuration("openai/gpt-4o-mini"), configuration("alibaba/qwen3.5-397b-a17b")],
			repetition_count: 1,
			transport_retry_limit: 0,
		}, null, 2)}\n`, "utf8");
		const retainedOutputs = await outputs();
		let ordinal = 0;
		const fetchCall = vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
			const body = typeof init?.body === "string" ? JSON.parse(init.body) as { model: string } : undefined;
			if (body === undefined) throw new Error("Expected Gateway request body");
			const metadata = typeof init?.headers === "object" && init.headers !== null && !Array.isArray(init.headers)
				? JSON.parse((init.headers as Record<string, string>)["cf-aig-metadata"]!) as { production_step: ProductionModelStep }
				: undefined;
			if (metadata === undefined) throw new Error("Expected Gateway request metadata");
			const step = metadata.production_step;
			ordinal += 1;
			return Promise.resolve(new Response(JSON.stringify({
				id: `provider-response-${String(ordinal)}`,
				object: "chat.completion",
				model: body.model,
				choices: [{ index: 0, message: { role: "assistant", content: retainedOutputs[step], refusal: null, annotations: [] }, finish_reason: "stop", logprobs: null }],
				usage: { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 },
				gatewayMetadata: { keySource: "Unified" },
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
			.map((invocation) => invocation.completion.provider))])).toEqual([["openai"], ["alibaba"]]);
		const captured = result.benchmark.gateway_requests.filter((record) => record.state === "captured");
		expect(captured).toHaveLength(8);
		expect(new Set(captured.map(({ provenance }) => provenance.gateway_log_id)).size).toBe(8);
		expect(captured.every(({ provenance }) => provenance.policy.max_attempts === 1
			&& provenance.policy.log_payload === false
			&& provenance.policy.request_format === "chat_completions"
			&& provenance.policy.structured_output?.format === "openai_chat_json_schema"
			&& provenance.policy.structured_output.contract_name.endsWith("_output")
			&& provenance.correlation.run_id === result.benchmark.id)).toBe(true);
		expect(fetchCall).toHaveBeenCalledTimes(8);
		for (const [, init] of fetchCall.mock.calls) {
			expect(init?.headers).toEqual(expect.objectContaining({
				"cf-aig-skip-cache": "true",
				"cf-aig-collect-log-payload": "false",
				"cf-aig-max-attempts": "1",
			}));
		}

		const named = configuration("openai/gpt-4o-mini", { selection: "named", id: "bc-news-evaluation" });
		const accountDefault = configuration("openai/gpt-4o-mini");
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

test("retains and reports sanitized Gateway response-contract failure locations", async () => {
	const root = await mkdtemp(join(tmpdir(), "bc-news-cloudflare-contract-failure-"));
	try {
		const configPath = join(root, "benchmark.config.json");
		const resultsDirectory = join(root, "results");
		await writeFile(configPath, `${JSON.stringify({
			configurations: [configuration("openai/gpt-4o-mini")],
			repetition_count: 1,
			transport_retry_limit: 0,
		}, null, 2)}\n`, "utf8");
		vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(Response.json({
			model: "provider-model",
			choices: [{ message: { content: "completion" } }],
			usage: { prompt_tokens: "sensitive-provider-value", completion_tokens: 1, total_tokens: 2 },
		})));

		const result = await evaluateBenchmarkCommand({
			fixturePath: REPRESENTATIVE_FIXTURE_PATH,
			configPath,
			resultsDirectory,
			environment: { CLOUDFLARE_ACCOUNT_ID: "account-id", CLOUDFLARE_API_TOKEN: "sentinel" },
			sourceProvenance: TEST_PROVENANCE,
		});
		const retained = V8BenchmarkRunSchema.parse(JSON.parse(await readFile(result.path, "utf8")) as unknown);
		const failures = retained.trials.flatMap(({ invocations }) => invocations.filter((invocation) => invocation.transport === "failed"));
		expect(failures).toHaveLength(2);
		for (const invocation of failures) {
			if (invocation.transport !== "failed") throw new Error("Expected failed invocation");
			expect(invocation.failure.details?.issues).toContainEqual({
				path: ["usage", "prompt_tokens"],
				code: "invalid_type",
				expected: "number",
				received_type: "string",
			});
		}
		const retainedJson = JSON.stringify(retained);
		expect(retainedJson).not.toContain("sensitive-provider-value");
		const report = formatBenchmarkRunReport(retained, result.path);
		expect(report).toContain("path=$.usage.prompt_tokens code=invalid_type expected=number received_type=string");
		expect(report).not.toContain("sensitive-provider-value");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}, 15_000);

test("retains null hosted content as a contract-rejected model output", async () => {
	const root = await mkdtemp(join(tmpdir(), "bc-news-cloudflare-null-content-"));
	try {
		const configPath = join(root, "benchmark.config.json");
		const resultsDirectory = join(root, "results");
		await writeFile(configPath, `${JSON.stringify({
			configurations: [configuration("openai/gpt-4o-mini")],
			repetition_count: 1,
			transport_retry_limit: 0,
		}, null, 2)}\n`, "utf8");
		const retainedOutputs = await outputs();
		let ordinal = 0;
		vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
			const body = typeof init?.body === "string" ? JSON.parse(init.body) as { model: string } : undefined;
			if (body === undefined) throw new Error("Expected Gateway request body");
			const metadata = typeof init?.headers === "object" && init.headers !== null && !Array.isArray(init.headers)
				? JSON.parse((init.headers as Record<string, string>)["cf-aig-metadata"]!) as { production_step: ProductionModelStep }
				: undefined;
			if (metadata === undefined) throw new Error("Expected Gateway request metadata");
			const step = metadata.production_step;
			ordinal += 1;
			return Promise.resolve(new Response(JSON.stringify({
				id: `provider-response-${String(ordinal)}`,
				model: body.model,
				choices: [{
					message: { content: step === "main_story_write" ? null : retainedOutputs[step] },
					finish_reason: step === "main_story_write" ? "length" : "stop",
				}],
				usage: { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 },
			}), { headers: { "cf-aig-log-id": `gateway-log-${String(ordinal)}` } }));
		});

		const result = await evaluateBenchmarkCommand({
			fixturePath: REPRESENTATIVE_FIXTURE_PATH,
			configPath,
			resultsDirectory,
			environment: { CLOUDFLARE_ACCOUNT_ID: "account-id", CLOUDFLARE_API_TOKEN: "sentinel" },
			sourceProvenance: TEST_PROVENANCE,
		});
		const retained = V8BenchmarkRunSchema.parse(JSON.parse(await readFile(result.path, "utf8")) as unknown);
		const trial = retained.trials[0]!;
		expect(trial.subject_outcome).toBe("contract_rejected");
		expect(trial.tracks.main_story).toMatchObject({
			lifecycle: "rejected",
			subject_outcome: "contract_rejected",
			terminal_production_step: "main_story_write",
		});
		expect(trial.tracks.announcements.subject_outcome).toBe("completed");
		expect(retained.outcome_counts).toEqual({
			completed: 0,
			parse_rejected: 0,
			contract_rejected: 1,
			infrastructure_incomplete: 0,
		});
		const mainInvocation = trial.invocations.find(({ production_step }) => production_step === "main_story_write");
		expect(mainInvocation).toMatchObject({
			transport: "succeeded",
			completion: {
				text: null,
				token_usage: { measurement: "reported", input_tokens: 100, output_tokens: 25, total_tokens: 125 },
			},
			parse: {
				state: "rejected",
				findings: [{ kind: "contract_mismatch", production_step: "main_story_write", code: "contract_mismatch" }],
			},
		});
		expect(retained.runtime_evidence.find(({ production_step }) => production_step === "main_story_write")).toMatchObject({
			state: "captured",
			evidence: { prediction_observation: { stop_reason: { state: "observed", value: "length" } } },
		});
		expect(retained.gateway_requests.find(({ production_step }) => production_step === "main_story_write")).toMatchObject({
			state: "captured",
			provenance: { gateway_log_id: "gateway-log-1" },
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}, 15_000);
