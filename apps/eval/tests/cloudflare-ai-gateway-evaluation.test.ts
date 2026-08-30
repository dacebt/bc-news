import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { PRODUCTION_MODEL_STEPS, type ProductionModelStep } from "@bc-news/generation-core";
import { RecordedModelResponseSchema } from "@bc-news/fixtures";
import type { CloudflareHostedModelId } from "@bc-news/model-adapters";
import { evaluateBenchmarkCommand } from "../src/evaluation-benchmark-command";
import { V9BenchmarkRunSchema, evaluationConfigIdentity } from "../src/evaluation-artifact";
import { TransportFailureDetailsSchema } from "../src/evaluation-artifact-schemas";
import { formatBenchmarkRunReport } from "../src/benchmark-run-report";
import { RECORDED_OUTPUT_FIXTURE_PATH } from "../src/representative-fixture";

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

test("runs Gemini Chat and Luna Responses through the Gateway contract and retains exact v9 provenance", async () => {
	const root = await mkdtemp(join(tmpdir(), "bc-news-cloudflare-ai-gateway-evaluation-"));
	try {
		const configPath = join(root, "benchmark.config.json");
		const resultsDirectory = join(root, "results");
		await writeFile(configPath, `${JSON.stringify({
			configurations: [configuration("google/gemini-3.7-flash"), configuration("openai/gpt-5.6-luna")],
			repetition_count: 1,
			transport_retry_limit: 0,
		}, null, 2)}\n`, "utf8");
		const retainedOutputs = await outputs();
		let ordinal = 0;
		const fetchCall = vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
			const body = typeof init?.body === "string" ? JSON.parse(init.body) as {
				model: string;
				input?: unknown;
				text?: { format?: { name?: string } };
			} : undefined;
			if (body === undefined) throw new Error("Expected Gateway request body");
			const metadata = typeof init?.headers === "object" && init.headers !== null && !Array.isArray(init.headers)
				? JSON.parse((init.headers as Record<string, string>)["cf-aig-metadata"]!) as { production_step: ProductionModelStep }
				: undefined;
			if (metadata === undefined) throw new Error("Expected Gateway request metadata");
			const step = metadata.production_step;
			ordinal += 1;
			if (body.model === "openai/gpt-5.6-luna") {
				return Promise.resolve(new Response(JSON.stringify({
					id: `provider-response-${String(ordinal)}`,
					object: "response",
					status: "completed",
					model: "gpt-5.6-luna",
					output: [{
						id: `message-${String(ordinal)}`,
						type: "message",
						status: "completed",
						role: "assistant",
						content: [{
							type: "output_text",
							text: retainedOutputs[step],
							annotations: [],
							logprobs: [],
						}],
					}],
					usage: { input_tokens: 100, output_tokens: 25, total_tokens: 125 },
				}), { headers: { "content-type": "application/json", "cf-aig-log-id": `gateway-log-${String(ordinal)}` } }));
			}
			return Promise.resolve(new Response(JSON.stringify({
				id: `provider-response-${String(ordinal)}`,
				object: "chat.completion",
				model: "gemini-3.7-flash",
				choices: [{ index: 0, message: { role: "assistant", content: retainedOutputs[step], refusal: null, annotations: [] }, finish_reason: "stop", logprobs: null }],
				usage: { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 },
				gatewayMetadata: { keySource: "Unified" },
			}), { headers: { "content-type": "application/json", "cf-aig-log-id": `gateway-log-${String(ordinal)}` } }));
		});

		const result = await evaluateBenchmarkCommand({
			fixturePath: RECORDED_OUTPUT_FIXTURE_PATH,
			configPath,
			resultsDirectory,
			environment: { CF_ACCOUNT_ID: "account-id", CF_AI_GATEWAY_API_TOKEN: "sentinel" },
			sourceProvenance: TEST_PROVENANCE,
		});

		expect(result.benchmark.version).toBe(9);
		if (result.benchmark.version !== 9) throw new Error("Expected V9 Gateway benchmark");
		expect(V9BenchmarkRunSchema.safeParse(result.benchmark).success).toBe(true);
		expect(result.benchmark.trials).toHaveLength(2);
		expect(result.benchmark.trials.every(({ subject_outcome }) => subject_outcome === "completed")).toBe(true);
		expect(result.benchmark.trials.map((trial) => [...new Set(trial.invocations
			.filter((invocation) => invocation.transport === "succeeded")
			.map((invocation) => invocation.completion.provider))])).toEqual([["google"], ["openai"]]);
		const captured = result.benchmark.gateway_requests.filter((record) => record.state === "captured");
		expect(captured).toHaveLength(4);
		expect(new Set(captured.map(({ provenance }) => provenance.gateway_log_id)).size).toBe(4);
		expect(captured.every(({ provenance }) => provenance.policy.max_attempts === 1
			&& provenance.policy.log_payload === false
			&& provenance.correlation.run_id === result.benchmark.id)).toBe(true);
		expect(captured.filter(({ provenance }) => provenance.requested_model === "google/gemini-3.7-flash").every(({ provenance }) =>
			provenance.policy.request_format === "chat_completions"
			&& provenance.policy.response_delivery === "buffered"
			&& provenance.policy.structured_output.format === "openai_chat_json_schema"
			&& provenance.policy.structured_output.contract_name.endsWith("_output"))).toBe(true);
		expect(captured.filter(({ provenance }) => provenance.requested_model === "openai/gpt-5.6-luna").every(({ provenance }) =>
			provenance.policy.request_format === "responses"
			&& provenance.policy.response_delivery === "buffered"
			&& provenance.policy.structured_output.format === "openai_responses_json_schema"
			&& provenance.policy.structured_output.contract_name.endsWith("_output"))).toBe(true);
		expect(result.benchmark.trials[1]?.invocations.every((invocation) =>
			invocation.transport !== "succeeded"
				|| (invocation.completion.model === "gpt-5.6-luna"
					&& invocation.completion.token_usage.measurement === "reported"
					&& invocation.completion.token_usage.input_tokens === 100
					&& invocation.completion.token_usage.output_tokens === 25
					&& invocation.completion.token_usage.total_tokens === 125))).toBe(true);
		const missingRequestFormat = structuredClone(result.benchmark);
		const missingCaptured = missingRequestFormat.gateway_requests.find((record) => record.state === "captured");
		if (missingCaptured?.state !== "captured") throw new Error("Expected captured Gateway provenance");
		delete (missingCaptured.provenance.policy as { request_format?: string }).request_format;
		expect(V9BenchmarkRunSchema.safeParse(missingRequestFormat).success).toBe(false);
		const contradictoryPolicy = structuredClone(result.benchmark);
		const contradictoryCaptured = contradictoryPolicy.gateway_requests.find((record) =>
			record.state === "captured" && record.provenance.requested_model === "openai/gpt-5.6-luna");
		if (contradictoryCaptured?.state !== "captured") throw new Error("Expected captured Luna provenance");
		contradictoryCaptured.provenance.policy.structured_output.format = "openai_chat_json_schema";
		expect(V9BenchmarkRunSchema.safeParse(contradictoryPolicy).success).toBe(false);
		expect(fetchCall).toHaveBeenCalledTimes(4);
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
		expect(V9BenchmarkRunSchema.safeParse({
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
			fixturePath: RECORDED_OUTPUT_FIXTURE_PATH,
			configPath,
			resultsDirectory,
			environment: { CF_ACCOUNT_ID: "account-id", CF_AI_GATEWAY_API_TOKEN: "sentinel" },
			sourceProvenance: TEST_PROVENANCE,
		});
		const retained = V9BenchmarkRunSchema.parse(JSON.parse(await readFile(result.path, "utf8")) as unknown);
		const failures = retained.trials.flatMap(({ invocations }) => invocations.filter((invocation) => invocation.transport === "failed"));
		expect(failures).toHaveLength(2);
		for (const invocation of failures) {
			if (invocation.transport !== "failed") throw new Error("Expected failed invocation");
			const details = TransportFailureDetailsSchema.parse(invocation.failure.details);
			expect(details.issues.some((issue) =>
				issue.code === "invalid_type"
				&& issue.expected === "number"
				&& issue.received_type === "string"
				&& issue.path.length === 2
				&& issue.path[0] === "usage"
				&& issue.path[1] === "prompt_tokens",
			)).toBe(true);
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

test("retains and reports the structured provider reason for a Gateway HTTP rejection", async () => {
	const root = await mkdtemp(join(tmpdir(), "bc-news-cloudflare-http-rejection-"));
	try {
		const configPath = join(root, "benchmark.config.json");
		const resultsDirectory = join(root, "results");
		await writeFile(configPath, `${JSON.stringify({
			configurations: [configuration("openai/gpt-4o")],
			repetition_count: 1,
			transport_retry_limit: 0,
		}, null, 2)}\n`, "utf8");
		vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(Response.json({
			error: {
				message: "Schema rejected at properties.main_story",
				type: "invalid_request_error",
				param: "response_format",
				code: null,
			},
		}, { status: 400 })));

		const result = await evaluateBenchmarkCommand({
			fixturePath: RECORDED_OUTPUT_FIXTURE_PATH,
			configPath,
			resultsDirectory,
			environment: { CF_ACCOUNT_ID: "account-id", CF_AI_GATEWAY_API_TOKEN: "sentinel" },
			sourceProvenance: TEST_PROVENANCE,
		});
		const retained = V9BenchmarkRunSchema.parse(JSON.parse(await readFile(result.path, "utf8")) as unknown);
		const failures = retained.trials.flatMap(({ invocations }) => invocations.filter((invocation) => invocation.transport === "failed"));
		expect(failures).toHaveLength(2);
		for (const invocation of failures) {
			if (invocation.transport !== "failed") throw new Error("Expected failed invocation");
			expect(invocation.failure.details).toEqual({
				contract: "cloudflare_ai_gateway_http_error_response",
				http_status: 400,
				issues: [{
					path: ["response_format"],
					code: "provider_rejection",
					provider_code: "invalid_request_error",
					provider_message: "Schema rejected at properties.main_story",
				}],
			});
		}
		const report = formatBenchmarkRunReport(retained, result.path);
		expect(report).toContain("http_status=400 path=$.response_format code=provider_rejection provider_code=invalid_request_error provider_message=Schema rejected at properties.main_story");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}, 15_000);

test("rejects null hosted content before retaining a current V9 artifact", async () => {
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

		await expect(evaluateBenchmarkCommand({
			fixturePath: RECORDED_OUTPUT_FIXTURE_PATH,
			configPath,
			resultsDirectory,
			environment: { CF_ACCOUNT_ID: "account-id", CF_AI_GATEWAY_API_TOKEN: "sentinel" },
			sourceProvenance: TEST_PROVENANCE,
		})).rejects.toThrow("Both evaluation tracks failed");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}, 15_000);
