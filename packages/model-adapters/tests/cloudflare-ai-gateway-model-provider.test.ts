import { afterEach, expect, it, vi } from "vitest";
import {
	CLOUDFLARE_AI_GATEWAY_REQUEST_TIMEOUT_MS,
	CLOUDFLARE_HOSTED_MODEL_IDS,
	CloudflareAiGatewayAdapterConfigSchema,
	CloudflareAiGatewayDeterministicError,
	CloudflareAiGatewayRetryableError,
	PRODUCTION_STEP_OUTPUT_CONTRACTS,
	cloudflareAiGatewayChatCompletionsUrl,
	cloudflareAiGatewayProviderForModel,
	createCloudflareAiGatewayModelProvider,
} from "../src/index";

afterEach(() => vi.restoreAllMocks());

function provider(
	model: typeof CLOUDFLARE_HOSTED_MODEL_IDS[number] = "openai/gpt-4o-mini",
	gateway?: { selection: "named"; id: string },
) {
	return createCloudflareAiGatewayModelProvider({
		accountId: "account-id",
		apiToken: "cloudflare-api-token",
		...(gateway === undefined ? {} : { gateway }),
		requestedModel: model,
		structuredOutputContracts: PRODUCTION_STEP_OUTPUT_CONTRACTS,
	});
}

function request(productionStep: keyof typeof PRODUCTION_STEP_OUTPUT_CONTRACTS = "main_story_write") {
	return {
		productionStep,
		system: "system constraints",
		user: "writer prompt",
		correlation: { run_id: "benchmark-one", invocation_id: "invocation-one" },
	};
}

function completionResponse(model = "gpt-4o-mini") {
	return new Response(JSON.stringify({
		id: "chatcmpl-one",
		object: "chat.completion",
		model,
		choices: [{
			index: 0,
			message: { role: "assistant", content: "completion", refusal: null, annotations: [] },
			finish_reason: "stop",
			logprobs: null,
		}],
		usage: { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 },
		gatewayMetadata: { keySource: "Unified" },
	}), { headers: { "content-type": "application/json", "cf-aig-log-id": "gateway-log-one" } });
}

it("accepts only non-secret Gateway configuration and canonical routed model-id syntax", () => {
	const candidate = {
		adapter: "cloudflare_ai_gateway",
		model: "openai/gpt-4o-mini",
	};
	expect(CloudflareAiGatewayAdapterConfigSchema.safeParse(candidate).success).toBe(true);
	expect(CloudflareAiGatewayAdapterConfigSchema.safeParse({
		...candidate,
		gateway: { selection: "named", id: "bc-news-evaluation" },
		model: "@cf/openai/gpt-oss-120b",
	}).success).toBe(true);
	expect(CloudflareAiGatewayAdapterConfigSchema.safeParse({
		...candidate,
		model: "@cf/openai/gpt-oss-120b",
	}).success).toBe(false);
	expect(CloudflareAiGatewayAdapterConfigSchema.safeParse({
		...candidate,
		gateway: { selection: "account_default" },
	}).success).toBe(false);
	expect(CloudflareAiGatewayAdapterConfigSchema.safeParse({ ...candidate, api_token: "secret" }).success).toBe(false);
	for (const model of ["gpt-4o-mini", "openai/", "@cf/meta/model"]) {
		expect(CloudflareAiGatewayAdapterConfigSchema.safeParse({ ...candidate, model }).success).toBe(false);
	}
	for (const historicalModel of ["openai/gpt-4.1-mini", "anthropic/claude-sonnet-4"]) {
		expect(CloudflareAiGatewayAdapterConfigSchema.safeParse({ ...candidate, model: historicalModel }).success).toBe(true);
	}
	expect(CloudflareAiGatewayAdapterConfigSchema.safeParse({ ...candidate, gateway: { selection: "named", id: " " } }).success).toBe(false);
});

it("rejects an unprofiled hosted model before transport", () => {
	const fetchCall = vi.spyOn(globalThis, "fetch");
	expect(() => createCloudflareAiGatewayModelProvider({
		accountId: "account-id",
		apiToken: "cloudflare-api-token",
		requestedModel: "openai/gpt-4.1-mini",
		structuredOutputContracts: PRODUCTION_STEP_OUTPUT_CONTRACTS,
	})).toThrowError(expect.objectContaining({ code: "cloudflare_ai_gateway_invalid_config" }));
	expect(fetchCall).not.toHaveBeenCalled();
});

it.each([
	["main_story_write", "main_story_write_output"],
	["main_story_copyedit", "main_story_copyedit_output"],
	["announcements_write", "announcements_write_output"],
	["announcements_copyedit", "announcements_copyedit_output"],
] as const)("sends the canonical %s output contract", async (productionStep, contractName) => {
	const fetchCall = vi.spyOn(globalThis, "fetch").mockResolvedValue(completionResponse());
	await provider().complete(request(productionStep));
	const [, init] = fetchCall.mock.calls[0]!;
	if (typeof init?.body !== "string") throw new Error("Expected request body to be JSON text");
	const body = JSON.parse(init.body) as {
		response_format: { json_schema: { name: string; schema: unknown } };
	};
	expect(body.response_format.json_schema).toEqual(expect.objectContaining({
		name: contractName,
		schema: PRODUCTION_STEP_OUTPUT_CONTRACTS[productionStep].schema,
	}));
});

it.each([
	["openai/gpt-5-nano", "openai"],
	["openai/gpt-4o-mini", "openai"],
	["alibaba/qwen3.5-397b-a17b", "alibaba"],
	["google/gemini-3.1-flash-lite", "google"],
	["@cf/openai/gpt-oss-120b", "workers_ai"],
])("derives truthful provider family %s", (model, expected) => {
	expect(cloudflareAiGatewayProviderForModel(model)).toBe(expected);
});

it("uses the fixed account REST endpoint with the account default Gateway", async () => {
	const fetchCall = vi.spyOn(globalThis, "fetch").mockResolvedValue(completionResponse());
	await provider().complete(request());
	expect(fetchCall).toHaveBeenCalledOnce();
	const [url, init] = fetchCall.mock.calls[0]!;
	if (!(url instanceof URL)) throw new Error("Expected Gateway endpoint URL");
	expect(url.href).toBe("https://api.cloudflare.com/client/v4/accounts/account-id/ai/v1/chat/completions");
	expect(init?.headers).toEqual(expect.objectContaining({
		Authorization: "Bearer cloudflare-api-token",
		"cf-aig-skip-cache": "true",
		"cf-aig-collect-log": "true",
		"cf-aig-collect-log-payload": "false",
		"cf-aig-max-attempts": "1",
		"cf-aig-request-timeout": String(CLOUDFLARE_AI_GATEWAY_REQUEST_TIMEOUT_MS),
		"cf-aig-metadata": JSON.stringify({
			bc_news_run_id: "benchmark-one",
			bc_news_invocation_id: "invocation-one",
			production_step: "main_story_write",
		}),
	}));
	expect(init?.headers).toEqual(expect.objectContaining({ "cf-aig-gateway-id": "default" }));
	const body = init?.body;
	if (typeof body !== "string") throw new Error("Expected request body to be JSON text");
	expect(JSON.parse(body) as unknown).toEqual({
		model: "openai/gpt-4o-mini",
		max_completion_tokens: 16_384,
		messages: [
			{ role: "system", content: "system constraints" },
			{ role: "user", content: "writer prompt" },
		],
		response_format: {
			type: "json_schema",
			json_schema: {
				name: "main_story_write_output",
				strict: true,
				schema: PRODUCTION_STEP_OUTPUT_CONTRACTS.main_story_write.schema,
			},
		},
	});
});

it.each([
	["openai/gpt-5-nano", "max_completion_tokens"],
	["openai/gpt-4o-mini", "max_completion_tokens"],
	["alibaba/qwen3.5-397b-a17b", "max_tokens"],
	["google/gemini-3.1-flash-lite", "max_tokens"],
	["@cf/openai/gpt-oss-120b", "max_tokens"],
] as const)("uses the researched output-token field for %s", async (model, outputTokenField) => {
	const fetchCall = vi.spyOn(globalThis, "fetch").mockResolvedValue(completionResponse());
	await provider(model, model.startsWith("@cf/") ? { selection: "named", id: "default" } : undefined).complete(request());
	const [, init] = fetchCall.mock.calls[0]!;
	if (typeof init?.body !== "string") throw new Error("Expected request body to be JSON text");
	const body = JSON.parse(init.body) as Record<string, unknown>;
	expect(body[outputTokenField]).toBe(16_384);
	expect(body[outputTokenField === "max_tokens" ? "max_completion_tokens" : "max_tokens"]).toBeUndefined();
	expect(body.response_format).toEqual({
		type: "json_schema",
		json_schema: {
			name: "main_story_write_output",
			strict: true,
			schema: PRODUCTION_STEP_OUTPUT_CONTRACTS.main_story_write.schema,
		},
	});
});

it("overrides the account default when a named Gateway is selected", async () => {
	const fetchCall = vi.spyOn(globalThis, "fetch").mockResolvedValue(completionResponse());
	await provider("openai/gpt-4o-mini", { selection: "named", id: "bc-news-evaluation" }).complete(request());
	const [, init] = fetchCall.mock.calls[0]!;
	expect(init?.headers).toEqual(expect.objectContaining({
		"cf-aig-gateway-id": "bc-news-evaluation",
	}));
});

it.each([
	["openai/gpt-4o-mini", "gpt-4o-mini", "openai"],
	["alibaba/qwen3.5-397b-a17b", "qwen3.5-397b-a17b", "alibaba"],
] as const)("retains response-scoped Gateway provenance for %s", async (requestedModel, responseModel, expectedProvider) => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(completionResponse(responseModel));
	await expect(provider(requestedModel).complete(request())).resolves.toMatchObject({
		text: "completion",
		provider: expectedProvider,
		model: responseModel,
		execution: "hosted_inference",
		token_usage: { measurement: "reported", input_tokens: 100, output_tokens: 25, total_tokens: 125 },
		external_billing: { classification: "unavailable", reason: "provider_did_not_report_cost" },
		request_provenance: {
			transport: "cloudflare_ai_gateway_rest",
			account_id: "account-id",
			gateway: { selection: "account_default" },
			gateway_log_id: "gateway-log-one",
			requested_model: requestedModel,
			correlation: { run_id: "benchmark-one", invocation_id: "invocation-one" },
			policy: {
				cache: "bypass",
				log_metadata: true,
				log_payload: false,
				max_attempts: 1,
				request_timeout_ms: CLOUDFLARE_AI_GATEWAY_REQUEST_TIMEOUT_MS,
				request_format: "chat_completions",
				structured_output: {
					format: "openai_chat_json_schema",
					contract_name: "main_story_write_output",
				},
				output_tokens: {
					field: requestedModel.startsWith("openai/") ? "max_completion_tokens" : "max_tokens",
					limit: 16_384,
				},
			},
		},
	});
});

it("preserves the application-facing completion text exactly", async () => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
		model: "gpt-4o-mini",
		choices: [{ message: { content: "  completion\n" } }],
		usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
	}), { headers: { "cf-aig-log-id": "gateway-log-one" } }));
	await expect(provider().complete(request())).resolves.toMatchObject({ text: "  completion\n" });
});

it("rejects credentials with surrounding whitespace before transport", () => {
	expect(() => createCloudflareAiGatewayModelProvider({
		accountId: "account-id",
		apiToken: " token",
		requestedModel: "openai/gpt-4o-mini",
		structuredOutputContracts: PRODUCTION_STEP_OUTPUT_CONTRACTS,
	})).toThrow(CloudflareAiGatewayDeterministicError);
});

it("requires correlation before making a paid request", async () => {
	const fetchCall = vi.spyOn(globalThis, "fetch");
	await expect(provider().complete({
		productionStep: "main_story_write",
		system: "system",
		user: "prompt",
	})).rejects.toMatchObject({ code: "cloudflare_ai_gateway_missing_correlation" });
	expect(fetchCall).not.toHaveBeenCalled();
});

it("retains a successful response when Cloudflare omits the Gateway log id", async () => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
		model: "gpt-4o-mini",
		choices: [{ message: { content: "completion" } }],
		usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
	}));
	await expect(provider().complete(request())).resolves.toMatchObject({
		text: "completion",
		request_provenance: {
			gateway_log_id: { state: "unavailable", reason: "provider_did_not_report" },
		},
	});
});

it("reports response-contract issue paths without retaining rejected values", async () => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
		model: "gpt-4o-mini",
		choices: [{ message: { content: "completion" } }],
		usage: { prompt_tokens: "sensitive-provider-value", completion_tokens: 1, total_tokens: 2 },
	}));
	const failure = await provider().complete(request()).catch((error: unknown) => error);
	expect(failure).toBeInstanceOf(CloudflareAiGatewayDeterministicError);
	if (!(failure instanceof CloudflareAiGatewayDeterministicError)) throw new Error("Expected deterministic Gateway failure");
	expect(failure.code).toBe("cloudflare_ai_gateway_response_contract_rejected");
	expect(failure.details?.contract).toBe("cloudflare_ai_gateway_chat_completion_response");
	expect(failure.details?.issues).toContainEqual({
		path: ["usage", "prompt_tokens"],
		code: "invalid_type",
		expected: "number",
		received_type: "string",
	});
	expect(JSON.stringify(failure)).not.toContain("sensitive-provider-value");
});

it.each([
	["Qwen", "alibaba/qwen3.5-397b-a17b", {
		model: "qwen3.5-397b-a17b",
		choices: [{ message: { content: "completion", reasoning_content: "provider extension" } }],
		usage: {
			prompt_tokens: 1,
			completion_tokens: 1,
			total_tokens: 2,
			prompt_tokens_details: { text_tokens: 1 },
			completion_tokens_details: { text_tokens: 1 },
		},
	}],
	["Gemini", "google/gemini-3.1-flash-lite", {
		model: "gemini-3.1-flash-lite",
		choices: [{ message: { content: "completion", extra_content: { provider: "metadata" } } }],
		usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, extra_properties: { provider: "metadata" } },
	}],
] as const)("accepts %s provider extensions outside consumed completion fields", async (_providerName, requestedModel, response) => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(response));
	await expect(provider(requestedModel).complete(request())).resolves.toMatchObject({
		text: "completion",
		token_usage: { measurement: "reported", input_tokens: 1, output_tokens: 1, total_tokens: 2 },
	});
});

it("accepts the Workers AI GPT-OSS Chat Completions envelope", async () => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
		id: "chatcmpl-gpt-oss",
		object: "chat.completion",
		created: 1,
		model: "@cf/openai/gpt-oss-120b",
		choices: [{
			index: 0,
			message: { role: "assistant", content: "completion", refusal: null, annotations: null },
			finish_reason: "stop",
			logprobs: null,
			routed_experts: null,
			stop_reason: 200002,
			token_ids: [1, 2, 3],
		}],
		usage: {
			prompt_tokens: 10,
			completion_tokens: 5,
			total_tokens: 15,
			prompt_tokens_details: null,
			completion_tokens_details: { reasoning_tokens: 3 },
		},
		provider_extension: { region: "provider-controlled" },
	}));
	await expect(provider("@cf/openai/gpt-oss-120b", { selection: "named", id: "default" }).complete(request())).resolves.toMatchObject({
		text: "completion",
		provider: "workers_ai",
		model: "@cf/openai/gpt-oss-120b",
		token_usage: { measurement: "reported", input_tokens: 10, output_tokens: 5, total_tokens: 15 },
	});
});

it("retains explicit Workers AI null content with its completion evidence", async () => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
		id: "chatcmpl-gpt-oss-null",
		model: "@cf/openai/gpt-oss-120b",
		choices: [{
			message: { role: "assistant", content: null, annotations: null },
			finish_reason: "length",
			routed_experts: null,
			stop_reason: 200002,
			token_ids: [1, 2, 3],
		}],
		usage: {
			prompt_tokens: 10,
			completion_tokens: 5,
			total_tokens: 15,
			completion_tokens_details: { reasoning_tokens: 5 },
		},
	}, { headers: { "cf-aig-log-id": "gateway-log-null" } }));
	await expect(provider("@cf/openai/gpt-oss-120b", { selection: "named", id: "default" }).complete(request())).resolves.toMatchObject({
		text: null,
		provider: "workers_ai",
		model: "@cf/openai/gpt-oss-120b",
		token_usage: { measurement: "reported", input_tokens: 10, output_tokens: 5, total_tokens: 15 },
		request_provenance: { gateway_log_id: "gateway-log-null" },
		runtime_evidence: {
			prediction_observation: { stop_reason: { state: "observed", value: "length" } },
		},
	});
});

it.each([408, 409, 425, 429, 500, 599])("classifies HTTP %i as retryable", async (status) => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status }));
	await expect(provider().complete(request())).rejects.toBeInstanceOf(CloudflareAiGatewayRetryableError);
});

it.each([400, 401, 403, 404, 422])("classifies HTTP %i as deterministic", async (status) => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status }));
	await expect(provider().complete(request())).rejects.toBeInstanceOf(CloudflareAiGatewayDeterministicError);
});

it("does not allow an alternate host in the adapter boundary", () => {
	expect(cloudflareAiGatewayChatCompletionsUrl("account/id").toString()).toBe(
		"https://api.cloudflare.com/client/v4/accounts/account%2Fid/ai/v1/chat/completions",
	);
	expect(() => cloudflareAiGatewayChatCompletionsUrl(" account-id")).toThrow(CloudflareAiGatewayDeterministicError);
});
