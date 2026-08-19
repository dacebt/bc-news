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

function responsesEnvelope(content: string) {
	return {
		id: "resp-one",
		object: "response",
		status: "completed",
		model: "gpt-5.6-luna",
		output: [{
			id: "msg-one",
			type: "message",
			status: "completed",
			role: "assistant",
			content: [{
				type: "output_text",
				text: content,
				annotations: [],
				logprobs: [],
			}],
		}],
		usage: { input_tokens: 100, output_tokens: 25, total_tokens: 125 },
	};
}

it("uses the Responses endpoint and retains Luna response semantics exactly", async () => {
	const fetchCall = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(responsesEnvelope(JSON.stringify({
		title: "The Daily",
		subtitle: "Market report",
		main_story: {
			headline: "Trade moved",
			lede: "Merchants gathered.",
			body: "The market was active.",
			image: { url: "https://example.com/image.png", caption: "Market", credit: null },
		},
	})), { headers: { "cf-aig-log-id": "gateway-log-one" } }));

	await expect(provider().complete(request())).resolves.toMatchObject({
		text: JSON.stringify({
			title: "The Daily",
			subtitle: "Market report",
			main_story: {
				headline: "Trade moved",
				lede: "Merchants gathered.",
				body: "The market was active.",
				image: { url: "https://example.com/image.png", caption: "Market" },
			},
		}),
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
		"incomplete status",
		{ ...responsesEnvelope("completion"), status: "incomplete" },
		{ path: ["status"], code: "custom" },
	],
	[
		"failed status",
		{ ...responsesEnvelope("completion"), status: "failed" },
		{ path: ["status"], code: "custom" },
	],
	[
		"in progress status",
		{ ...responsesEnvelope("completion"), status: "in_progress" },
		{ path: ["status"], code: "custom" },
	],
	[
		"refusal content",
		{
			...responsesEnvelope("completion"),
			output: [{
				id: "msg-one",
				type: "message",
				status: "completed",
				role: "assistant",
				content: [{ type: "refusal", refusal: "sensitive-provider-value" }],
			}],
		},
		{ path: ["output", 0, "content", 0, "type"], code: "custom" },
	],
	[
		"zero text items",
		{
			...responsesEnvelope("completion"),
			output: [{
				id: "msg-one",
				type: "message",
				status: "completed",
				role: "assistant",
				content: [],
			}],
		},
		{ path: ["output", 0, "content"], code: "custom" },
	],
	[
		"multiple text items",
		{
			...responsesEnvelope("completion"),
			output: [{
				id: "msg-one",
				type: "message",
				status: "completed",
				role: "assistant",
				content: [
					{ type: "output_text", text: "one" },
					{ type: "output_text", text: "two" },
				],
			}],
		},
		{ path: ["output", 0, "content"], code: "custom" },
	],
	[
		"multiple messages",
		{
			...responsesEnvelope("completion"),
			output: [
				responsesEnvelope("completion").output[0],
				responsesEnvelope("completion").output[0],
			],
		},
		{ path: ["output"], code: "custom" },
	],
	[
		"malformed usage",
		{
			...responsesEnvelope("completion"),
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
