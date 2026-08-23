import { afterEach, expect, it, vi } from "vitest";
import {
	CLOUDFLARE_AI_GATEWAY_REQUEST_TIMEOUT_MS,
	CLOUDFLARE_HOSTED_MODEL_IDS,
	CloudflareAiGatewayAdapterConfigSchema,
	PRODUCTION_STEP_OUTPUT_CONTRACTS,
	cloudflareAiGatewayProviderForModel,
	createCloudflareAiGatewayModelProvider,
} from "../src/index";
import {
	completionResponse,
	provider,
	request,
	successfulResponse,
} from "./cloudflare-ai-gateway-model-provider-test-helpers";

afterEach(() => vi.restoreAllMocks());

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
	["announcements_write", "announcements_write_output"],
] as const)("sends the profiled %s output contract", async (productionStep, contractName) => {
	const fetchCall = vi.spyOn(globalThis, "fetch").mockResolvedValue(completionResponse());
	await provider().complete(request(productionStep));
	const [, init] = fetchCall.mock.calls[0]!;
	if (typeof init?.body !== "string") throw new Error("Expected request body to be JSON text");
	const body = JSON.parse(init.body) as {
		response_format: { json_schema: { name: string; schema: unknown } };
	};
	expect(body.response_format.json_schema.name).toBe(contractName);
	expect(body.response_format.json_schema.schema).toEqual(PRODUCTION_STEP_OUTPUT_CONTRACTS[productionStep].schema);
});

it.each([
	["google/gemini-2.5-flash-lite", "gemini-2.5-flash-lite"],
	["google/gemini-3.1-flash-lite", "gemini-3.1-flash-lite"],
	["google/gemini-3.7-flash", "gemini-3.7-flash"],
	["minimax/m3", "MiniMax-M3"],
] as const)("leaves %s canonical optional fields unchanged", async (model, responseModel) => {
	const fetchCall = vi.spyOn(globalThis, "fetch").mockResolvedValue(completionResponse(responseModel));
	await provider(model).complete(request());
	const [, init] = fetchCall.mock.calls[0]!;
	if (typeof init?.body !== "string") throw new Error("Expected request body to be JSON text");
	const body = JSON.parse(init.body) as {
		response_format: { json_schema: { schema: unknown } };
	};
	expect(body.response_format.json_schema.schema).toEqual(PRODUCTION_STEP_OUTPUT_CONTRACTS.main_story_write.schema);
});

it.each([
	["openai/gpt-5-nano", "openai"],
	["openai/gpt-5-mini", "openai"],
	["openai/gpt-5.6-luna", "openai"],
	["openai/gpt-4o", "openai"],
	["openai/gpt-4o-mini", "openai"],
	["alibaba/qwen3.5-397b-a17b", "alibaba"],
	["google/gemini-2.5-flash-lite", "google"],
	["google/gemini-3.1-flash-lite", "google"],
	["google/gemini-3.7-flash", "google"],
	["minimax/m3", "minimax"],
	["@cf/openai/gpt-oss-120b", "workers_ai"],
	["@cf/google/gemma-4-26b-a4b-it", "workers_ai"],
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
		"cf-aig-gateway-id": "default",
	}));
});

it.each(CLOUDFLARE_HOSTED_MODEL_IDS)("leaves the output-token ceiling unset for %s", async (model) => {
	const fetchCall = vi.spyOn(globalThis, "fetch").mockResolvedValue(successfulResponse(model));
	await provider(model, model.startsWith("@cf/") ? { selection: "named", id: "default" } : undefined).complete(request());
	const [, init] = fetchCall.mock.calls[0]!;
	if (typeof init?.body !== "string") throw new Error("Expected request body to be JSON text");
	const body = JSON.parse(init.body) as Record<string, unknown>;
	expect(body.max_tokens).toBeUndefined();
	expect(body.max_completion_tokens).toBeUndefined();
	expect(body.max_output_tokens).toBeUndefined();
	if (model === "openai/gpt-5.6-luna") {
		expect(body.text).toMatchObject({
			format: {
				type: "json_schema",
				name: "main_story_write_output",
				strict: true,
			},
		});
		expect(body.response_format).toBeUndefined();
	} else {
		expect(body.response_format).toMatchObject({
			type: "json_schema",
			json_schema: {
				name: "main_story_write_output",
				strict: true,
			},
		});
	}
});

it("overrides the account default when a named Gateway is selected", async () => {
	const fetchCall = vi.spyOn(globalThis, "fetch").mockResolvedValue(completionResponse());
	await provider("openai/gpt-4o-mini", { selection: "named", id: "bc-news-evaluation" }).complete(request());
	const [, init] = fetchCall.mock.calls[0]!;
	expect(init?.headers).toEqual(expect.objectContaining({
		"cf-aig-gateway-id": "bc-news-evaluation",
	}));
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
