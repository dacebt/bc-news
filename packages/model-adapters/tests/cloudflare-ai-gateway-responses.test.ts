import { afterEach, expect, it, vi } from "vitest";
import {
	CLOUDFLARE_AI_GATEWAY_REQUEST_TIMEOUT_MS,
	CloudflareAiGatewayDeterministicError,
	PRODUCTION_STEP_OUTPUT_CONTRACTS,
	createCloudflareAiGatewayModelProvider,
} from "../src/index";

afterEach(() => vi.restoreAllMocks());

function provider() {
	return createCloudflareAiGatewayModelProvider({
		accountId: "account-id",
		apiToken: "cloudflare-api-token",
		requestedModel: "openai/gpt-5.6-luna",
		structuredOutputContracts: PRODUCTION_STEP_OUTPUT_CONTRACTS,
	});
}

function request() {
	return {
		productionStep: "main_story_write" as const,
		system: "system constraints",
		user: "writer prompt",
		correlation: { run_id: "benchmark-one", invocation_id: "invocation-one" },
	};
}

const completedStory = JSON.stringify({
	title: "The Daily",
	main_story: {
		headline: "Trade moved",
		lede: "Merchants gathered.",
		body: "The market was active.",
	},
});

const expectedStory = {
	title: "The Daily",
	main_story: {
		headline: "Trade moved",
		lede: "Merchants gathered.",
		body: "The market was active.",
	},
};

function outputTextContent(text: string) {
	return {
		type: "output_text",
		text,
		annotations: [],
		logprobs: [],
	};
}

function assistantMessage(parts: readonly string[]) {
	return {
		id: "msg-one",
		type: "message",
		status: "completed",
		role: "assistant",
		content: parts.map((text) => outputTextContent(text)),
	};
}

function reasoningItem() {
	return {
		id: "reasoning-one",
		type: "reasoning",
		summary: [{ type: "summary_text", text: "provider-controlled reasoning" }],
	};
}

function responsesEnvelope(output: readonly Record<string, unknown>[] = [assistantMessage(["completion"])]) {
	return {
		id: "resp-one",
		object: "response",
		status: "completed",
		model: "gpt-5.6-luna",
		output,
		usage: { input_tokens: 100, output_tokens: 25, total_tokens: 125 },
	};
}

it("uses the Responses endpoint and retains Luna response semantics exactly", async () => {
	const fetchCall = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(
		responsesEnvelope([assistantMessage([completedStory])]),
		{ headers: { "cf-aig-log-id": "gateway-log-one" } },
	));

	await expect(provider().complete(request())).resolves.toMatchObject({
		text: JSON.stringify(expectedStory),
		provider: "openai",
		model: "gpt-5.6-luna",
		token_usage: { measurement: "reported", input_tokens: 100, output_tokens: 25, total_tokens: 125 },
		request_provenance: {
			transport: "cloudflare_ai_gateway_rest",
			gateway_log_id: "gateway-log-one",
			requested_model: "openai/gpt-5.6-luna",
			policy: {
				cache: "bypass",
				log_metadata: true,
				log_payload: false,
				max_attempts: 1,
				request_timeout_ms: CLOUDFLARE_AI_GATEWAY_REQUEST_TIMEOUT_MS,
				request_format: "responses",
				response_delivery: "buffered",
				structured_output: {
					format: "openai_responses_json_schema",
					contract_name: "main_story_write_output",
				},
			},
		},
		runtime_evidence: {
			execution_context: {
				selected_model: { requested_identity: { state: "observed", value: "openai/gpt-5.6-luna" } },
				response_model: {
					requested_identity: { state: "observed", value: "openai/gpt-5.6-luna" },
					identifier: { state: "observed", value: "gpt-5.6-luna" },
				},
			},
			prediction_observation: {
				provider_response_id: { state: "observed", value: "resp-one" },
				stop_reason: { state: "observed", value: "completed" },
			},
		},
	});

	expect(fetchCall).toHaveBeenCalledOnce();
	const [url, init] = fetchCall.mock.calls[0]!;
	if (!(url instanceof URL)) throw new Error("Expected Responses endpoint URL");
	expect(url.href).toBe("https://api.cloudflare.com/client/v4/accounts/account-id/ai/v1/responses");
	expect(init?.headers).toEqual(expect.objectContaining({
		"cf-aig-gateway-id": "default",
		"cf-aig-request-timeout": String(CLOUDFLARE_AI_GATEWAY_REQUEST_TIMEOUT_MS),
	}));
	if (typeof init?.body !== "string") throw new Error("Expected request body to be JSON text");
	const body = JSON.parse(init.body) as Record<string, unknown>;
	expect(body).toMatchObject({
		model: "openai/gpt-5.6-luna",
		input: [
			{ role: "system", content: "system constraints" },
			{ role: "user", content: "writer prompt" },
		],
		text: {
			format: {
				type: "json_schema",
				name: "main_story_write_output",
				strict: true,
			},
		},
	});
	expect(body.stream).toBeUndefined();
	expect(body.max_output_tokens).toBeUndefined();
	expect(body.response_format).toBeUndefined();
});

it.each([
	[
		"reasoning before the final message",
		responsesEnvelope([reasoningItem(), assistantMessage([completedStory])]),
	],
	[
		"message before trailing reasoning",
		responsesEnvelope([assistantMessage([completedStory]), reasoningItem()]),
	],
] as const)("accepts %s", async (_label, candidate) => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(candidate, { headers: { "cf-aig-log-id": "gateway-log-one" } }));

	await expect(provider().complete(request())).resolves.toMatchObject({
		text: JSON.stringify(expectedStory),
	});
});

it("concatenates multipart output_text content in order", async () => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(
		responsesEnvelope([assistantMessage([
			"{\"title\":\"The Daily\",",
			"\"main_story\":{\"headline\":\"Trade moved\",\"lede\":\"Merchants gathered.\",",
			"\"body\":\"The market was active.\"}}",
		])]),
		{ headers: { "cf-aig-log-id": "gateway-log-one" } },
	));

	await expect(provider().complete(request())).resolves.toMatchObject({
		text: JSON.stringify(expectedStory),
	});
});

it("accepts unrelated provider extensions on the completed assistant message", async () => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(
		responsesEnvelope([{
			...assistantMessage([completedStory]),
			provider_extension: { trace_id: "trace-one" },
		}]),
		{ headers: { "cf-aig-log-id": "gateway-log-one" } },
	));

	await expect(provider().complete(request())).resolves.toMatchObject({
		text: JSON.stringify(expectedStory),
	});
});

it.each([
	[
		"incomplete status",
		{ ...responsesEnvelope(), status: "incomplete" },
		{ path: ["status"], code: "custom" },
	],
	[
		"failed status",
		{ ...responsesEnvelope(), status: "failed" },
		{ path: ["status"], code: "custom" },
	],
	[
		"in progress status",
		{ ...responsesEnvelope(), status: "in_progress" },
		{ path: ["status"], code: "custom" },
	],
	[
		"refusal content",
		{
			...responsesEnvelope(),
			output: [{
				...assistantMessage(["completion"]),
				content: [{ type: "refusal", refusal: "sensitive-provider-value" }],
			}],
		},
		{ path: ["output", 0, "content", 0, "type"], code: "custom" },
	],
	[
		"zero text items",
		{
			...responsesEnvelope(),
			output: [{ ...assistantMessage(["completion"]), content: [] }],
		},
		{ path: ["output", 0, "content"], code: "custom" },
	],
	[
		"blank text item",
		{
			...responsesEnvelope(),
			output: [{ ...assistantMessage(["completion"]), content: [outputTextContent("   ")] }],
		},
		{ path: ["output", 0, "content", 0, "text"], code: "custom" },
	],
	[
		"unknown output item",
		{
			...responsesEnvelope(),
			output: [{ id: "item-one", type: "output_image", url: "https://example.com/output.png" }],
		},
		{ path: ["output", 0, "type"], code: "custom" },
	],
	[
		"tool output item",
		{
			...responsesEnvelope(),
			output: [{ id: "item-one", type: "function_call", name: "write_story" }],
		},
		{ path: ["output", 0, "type"], code: "custom" },
	],
	[
		"multiple messages",
		{
			...responsesEnvelope(),
			output: [
				assistantMessage(["completion"]),
				reasoningItem(),
				{ ...assistantMessage(["completion two"]), id: "msg-two" },
			],
		},
		{ path: ["output"], code: "custom" },
	],
	[
		"message-level tool calls",
		{
			...responsesEnvelope(),
			output: [{
				...assistantMessage(["completion"]),
				tool_calls: [{ id: "sensitive-provider-value", type: "function" }],
			}],
		},
		{ path: ["output", 0, "tool_calls"], code: "custom" },
	],
	[
		"message-level legacy function call metadata",
		{
			...responsesEnvelope(),
			output: [{
				...assistantMessage(["completion"]),
				function_call: { name: "write_story", arguments: "sensitive-provider-value" },
			}],
		},
		{ path: ["output", 0, "function_call"], code: "custom" },
	],
	[
		"missing message",
		{
			...responsesEnvelope(),
			output: [reasoningItem()],
		},
		{ path: ["output"], code: "custom" },
	],
	[
		"malformed usage",
		{
			...responsesEnvelope(),
			usage: { input_tokens: "sensitive-provider-value", output_tokens: 25, total_tokens: 125 },
		},
		{ path: ["usage", "input_tokens"], code: "invalid_type", expected: "number" },
	],
] as const)("rejects %s with sanitized Responses contract details", async (_label, candidate, expectedIssue) => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(candidate, { headers: { "cf-aig-log-id": "gateway-log-one" } }));

	const failure = await provider().complete(request()).catch((error: unknown) => error);
	expect(failure).toBeInstanceOf(CloudflareAiGatewayDeterministicError);
	if (!(failure instanceof CloudflareAiGatewayDeterministicError)) throw new Error("Expected deterministic Gateway failure");
	expect(failure.code).toBe("cloudflare_ai_gateway_response_contract_rejected");
	expect(failure.details?.contract).toBe("cloudflare_ai_gateway_responses_response");
	expect(failure.details?.issues).toContainEqual(expect.objectContaining(expectedIssue));
	expect(JSON.stringify(failure)).not.toContain("sensitive-provider-value");
});
