import { afterEach, expect, it, vi } from "vitest";
import {
	CloudflareAiGatewayDeterministicError,
	CloudflareAiGatewayRetryableError,
	cloudflareAiGatewayChatCompletionsUrl,
	createCloudflareAiGatewayModelProvider,
	PRODUCTION_STEP_OUTPUT_CONTRACTS,
} from "../src/index";
import {
	provider,
	request,
	streamingCompletionResponse,
} from "./cloudflare-ai-gateway-model-provider-test-helpers";

afterEach(() => vi.restoreAllMocks());

it("classifies a truncated GPT-5 Mini stream as retryable infrastructure failure", async () => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(streamingCompletionResponse("completion", "gpt-5-mini", false));
	await expect(provider("openai/gpt-5-mini").complete(request())).rejects.toMatchObject({
		code: "cloudflare_ai_gateway_network_failure",
	});
});

it("rejects credentials with surrounding whitespace before transport", () => {
	expect(() => createCloudflareAiGatewayModelProvider({
		accountId: "account-id",
		apiToken: " token",
		requestedModel: "openai/gpt-4o-mini",
		structuredOutputContracts: PRODUCTION_STEP_OUTPUT_CONTRACTS,
	})).toThrow(CloudflareAiGatewayDeterministicError);
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

it.each([408, 409, 425, 429, 500, 599])("classifies HTTP %i as retryable", async (status) => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status }));
	await expect(provider().complete(request())).rejects.toBeInstanceOf(CloudflareAiGatewayRetryableError);
});

it.each([400, 401, 403, 404, 422])("classifies HTTP %i as deterministic", async (status) => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status }));
	await expect(provider().complete(request())).rejects.toBeInstanceOf(CloudflareAiGatewayDeterministicError);
});

it("retains the bounded structured provider reason for an HTTP rejection", async () => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
		error: {
			message: "Schema rejected at properties.main_story",
			type: "invalid_request_error",
			param: "response_format",
			code: null,
		},
	}, { status: 400 }));
	const failure = await provider().complete(request()).catch((error: unknown) => error);
	expect(failure).toBeInstanceOf(CloudflareAiGatewayDeterministicError);
	if (!(failure instanceof CloudflareAiGatewayDeterministicError)) throw new Error("Expected deterministic Gateway failure");
	expect(failure.details).toEqual({
		contract: "cloudflare_ai_gateway_http_error_response",
		http_status: 400,
		issues: [{
			path: ["response_format"],
			code: "provider_rejection",
			provider_code: "invalid_request_error",
			provider_message: "Schema rejected at properties.main_story",
		}],
	});
});

it("does not allow an alternate host in the adapter boundary", () => {
	expect(cloudflareAiGatewayChatCompletionsUrl("account/id").toString()).toBe(
		"https://api.cloudflare.com/client/v4/accounts/account%2Fid/ai/v1/chat/completions",
	);
	expect(() => cloudflareAiGatewayChatCompletionsUrl(" account-id")).toThrow(CloudflareAiGatewayDeterministicError);
});
