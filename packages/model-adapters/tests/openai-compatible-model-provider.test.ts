import { afterEach, expect, it, vi } from "vitest";
import {
	HostedModelAdapterConfigSchema,
	OpenAiCompatibleDeterministicError,
	OpenAiCompatibleRetryableError,
	createOpenAiCompatibleModelProvider,
	openAiCompatibleChatCompletionsUrl,
} from "../src/index";

afterEach(() => vi.restoreAllMocks());

it("accepts only complete non-secret hosted configuration", () => {
	const candidate = hostedProviderConfig();
	expect(HostedModelAdapterConfigSchema.safeParse(candidate).success).toBe(true);
	expect(HostedModelAdapterConfigSchema.safeParse({ ...candidate, api_key: "secret" }).success).toBe(false);
	expect(HostedModelAdapterConfigSchema.safeParse({ ...candidate, provider: " " }).success).toBe(false);
	expect(HostedModelAdapterConfigSchema.safeParse({
		...candidate,
		billing: { ...candidate.billing, input_usd_per_million_tokens: -1 },
	}).success).toBe(false);
});

function hostedProviderConfig() {
	return {
		adapter: "openai_compatible_hosted" as const,
		provider: "verify-hosted",
		model: "requested-model",
		billing: {
			method: "calculated" as const,
			input_usd_per_million_tokens: 2,
			output_usd_per_million_tokens: 8,
			pricing_reference: "verify-prices",
		},
	};
}

function hostedProvider() {
	const config = hostedProviderConfig();
	return createOpenAiCompatibleModelProvider({
		execution: "hosted_inference",
		baseUrl: "http://127.0.0.1:7777/v1",
		apiKey: "sentinel-secret",
		provider: config.provider,
		requestedModel: config.model,
		billing: config.billing,
	});
}

it("maps strict hosted provenance, usage, and calculated billing", async () => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
		model: "returned-model",
		choices: [{ message: { content: "completion" } }],
		usage: { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 },
	}));

	await expect(hostedProvider().complete({
		editorialCapability: "main_story",
		system: "system",
		user: "prompt",
	})).resolves.toEqual({
		text: "completion",
		provider: "verify-hosted",
		model: "returned-model",
		execution: "hosted_inference",
		token_usage: { measurement: "reported", input_tokens: 100, output_tokens: 25, total_tokens: 125 },
		external_billing: { classification: "calculated", amount_usd: 0.0004, pricing_reference: "verify-prices" },
	});
});

it("accepts an ordinary OpenAI-compatible completion envelope", async () => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
		id: "chatcmpl-verify",
		object: "chat.completion",
		created: 1_785_882_800,
		model: "returned-model",
		choices: [{
			index: 0,
			message: { role: "assistant", content: "completion", refusal: null },
			finish_reason: "stop",
			logprobs: null,
		}],
		usage: {
			prompt_tokens: 100,
			completion_tokens: 25,
			total_tokens: 125,
			prompt_tokens_details: { cached_tokens: 20, audio_tokens: 0 },
			completion_tokens_details: {
				reasoning_tokens: 5,
				audio_tokens: 0,
				accepted_prediction_tokens: 0,
				rejected_prediction_tokens: 0,
			},
		},
		service_tier: "default",
		system_fingerprint: "fp_verify",
	}));

	await expect(hostedProvider().complete({
		editorialCapability: "main_story",
		system: "system",
		user: "prompt",
	})).resolves.toMatchObject({ text: "completion", model: "returned-model" });
});

it.each([
	{ model: "m", invented: true, choices: [{ message: { content: "x" } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
	{ model: "m", choices: [{ invented: true, message: { content: "x" } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
	{ model: "m", choices: [{ message: { content: "x", invented: true } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
	{ model: "m", choices: [{ message: { content: "x" } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, invented: true } },
])("rejects invented completion-envelope fields %#", async (candidate) => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(candidate));
	await expect(hostedProvider().complete({ editorialCapability: "main_story", system: "s", user: "u" }))
		.rejects.toMatchObject({ code: "openai_compatible_response_contract_rejected" });
});

it.each([408, 409, 425, 429, 500, 599])("classifies HTTP %i as retryable", async (status) => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status }));
	await expect(hostedProvider().complete({ editorialCapability: "main_story", system: "s", user: "u" }))
		.rejects.toBeInstanceOf(OpenAiCompatibleRetryableError);
});

it.each([400, 401, 403, 404, 422])("classifies HTTP %i as deterministic", async (status) => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status }));
	await expect(hostedProvider().complete({ editorialCapability: "main_story", system: "s", user: "u" }))
		.rejects.toBeInstanceOf(OpenAiCompatibleDeterministicError);
});

it.each([
	{},
	{ model: "m", choices: [] },
	{ model: "m", choices: [{ message: { content: "x" } }, { message: { content: "y" } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
	{ model: "m", choices: [{ message: { content: "x" } }] },
	{ model: "m", choices: [{ message: { content: "x" } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 3 } },
])("rejects malformed hosted response %# without echoing it", async (candidate) => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(candidate));
	const error = await hostedProvider().complete({ editorialCapability: "main_story", system: "s", user: "u" })
		.catch((failure: unknown) => failure);
	expect(error).toBeInstanceOf(OpenAiCompatibleDeterministicError);
	expect(String(error)).not.toContain(JSON.stringify(candidate));
});

it.each([
	"http://user:secret@localhost/v1",
	"ftp://localhost/v1",
	"http://localhost/v1?secret=value",
	" http://localhost/v1",
])("rejects unsafe base URL %s", (baseUrl) => {
	expect(() => openAiCompatibleChatCompletionsUrl(baseUrl)).toThrow(OpenAiCompatibleDeterministicError);
});
