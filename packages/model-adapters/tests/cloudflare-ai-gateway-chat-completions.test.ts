import { afterEach, expect, it, vi } from "vitest";
import {
	CLOUDFLARE_AI_GATEWAY_REQUEST_TIMEOUT_MS,
} from "../src/index";
import {
	completionResponse,
	completionResponseWithContent,
	provider,
	request,
	streamingCompletionResponse,
} from "./cloudflare-ai-gateway-model-provider-test-helpers";

afterEach(() => vi.restoreAllMocks());

it("streams only GPT-5 Mini, buffers the full content, and retains reported usage", async () => {
	const content = JSON.stringify({
		title: "The Daily",
		subtitle: "Market report",
		main_story: {
			headline: "Trade moved",
			lede: "Merchants gathered.",
			body: "The market was active.",
			image: null,
		},
	});
	const fetchCall = vi.spyOn(globalThis, "fetch").mockResolvedValue(streamingCompletionResponse(content));
	await expect(provider("openai/gpt-5-mini").complete(request())).resolves.toMatchObject({
		text: JSON.stringify({
			title: "The Daily",
			subtitle: "Market report",
			main_story: {
				headline: "Trade moved",
				lede: "Merchants gathered.",
				body: "The market was active.",
			},
		}),
		model: "gpt-5-mini",
		token_usage: { measurement: "reported", input_tokens: 100, output_tokens: 25, total_tokens: 125 },
		request_provenance: {
			gateway_log_id: "gateway-log-stream-one",
			policy: { response_delivery: "streaming" },
		},
	});
	const [, init] = fetchCall.mock.calls[0]!;
	if (typeof init?.body !== "string") throw new Error("Expected request body to be JSON text");
	expect(JSON.parse(init.body)).toMatchObject({
		stream: true,
		stream_options: { include_usage: true },
		response_format: { type: "json_schema" },
	});
});

it("keeps successful hosted models on buffered delivery", async () => {
	const fetchCall = vi.spyOn(globalThis, "fetch").mockResolvedValue(completionResponse("gemma-4-26b-a4b-it"));
	await expect(provider("@cf/google/gemma-4-26b-a4b-it", { selection: "named", id: "default" }).complete(request())).resolves.toMatchObject({
		request_provenance: { policy: { response_delivery: "buffered" } },
	});
	const [, init] = fetchCall.mock.calls[0]!;
	if (typeof init?.body !== "string") throw new Error("Expected request body to be JSON text");
	const body = JSON.parse(init.body) as Record<string, unknown>;
	expect(body.stream).toBeUndefined();
	expect(body.stream_options).toBeUndefined();
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

it("normalizes OpenAI null placeholders back to canonical optional fields", async () => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(completionResponseWithContent(JSON.stringify({
		title: "The Daily",
		subtitle: "Market report",
		main_story: {
			headline: "Trade moved",
			lede: "Merchants gathered.",
			body: "The market was active.",
			image: null,
		},
	})));
	await expect(provider("openai/gpt-4o").complete(request())).resolves.toMatchObject({
		text: JSON.stringify({
			title: "The Daily",
			subtitle: "Market report",
			main_story: {
				headline: "Trade moved",
				lede: "Merchants gathered.",
				body: "The market was active.",
			},
		}),
	});
});

it("normalizes a nested OpenAI null placeholder without removing its parent", async () => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(completionResponseWithContent(JSON.stringify({
		title: "The Daily",
		subtitle: "Market report",
		main_story: {
			headline: "Trade moved",
			lede: "Merchants gathered.",
			body: "The market was active.",
			image: { url: "https://example.com/image.png", caption: "Market", credit: null },
		},
	})));
	await expect(provider("openai/gpt-5-nano").complete(request())).resolves.toMatchObject({
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
	});
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
	["MiniMax", "minimax/m3", {
		id: "minimax-completion",
		model: "MiniMax-M3",
		object: "chat.completion",
		choices: [{
			message: {
				role: "assistant",
				content: "completion",
				name: "MiniMax AI",
				audio_content: "",
				reasoning_content: "provider extension",
				reasoning_details: [{ type: "reasoning.text", text: "provider extension" }],
			},
			finish_reason: "stop",
		}],
		usage: {
			prompt_tokens: 1,
			completion_tokens: 1,
			total_tokens: 2,
			total_characters: 0,
			prompt_tokens_details: { cached_tokens: 0 },
		},
		input_sensitive: false,
		output_sensitive: false,
		base_resp: { status_code: 0, status_msg: "" },
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
