import { afterEach, expect, it, vi } from "vitest";
import {
	HostedModelAdapterConfigSchema,
	OpenAiCompatibleDeterministicError,
	OpenAiCompatibleRetryableError,
	createOpenAiCompatibleModelProvider,
	openAiCompatibleChatCompletionsUrl,
} from "../src/index";

afterEach(() => vi.restoreAllMocks());

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

function hostedProvider(temperature?: number) {
	const config = hostedProviderConfig();
	return createOpenAiCompatibleModelProvider({
		execution: "hosted_inference",
		baseUrl: "http://127.0.0.1:7777/v1",
		apiKey: "sentinel-secret",
		provider: config.provider,
		requestedModel: config.model,
		billing: config.billing,
		...(temperature === undefined ? {} : { temperature }),
	});
}

it("accepts only complete non-secret hosted configuration with optional temperature", () => {
	const candidate = hostedProviderConfig();
	expect(HostedModelAdapterConfigSchema.safeParse(candidate).success).toBe(true);
	expect(HostedModelAdapterConfigSchema.safeParse({ ...candidate, temperature: 0.6 }).success).toBe(true);
	expect(HostedModelAdapterConfigSchema.safeParse({ ...candidate, api_key: "secret" }).success).toBe(false);
	expect(HostedModelAdapterConfigSchema.safeParse({ ...candidate, provider: " " }).success).toBe(false);
	expect(HostedModelAdapterConfigSchema.safeParse({ ...candidate, temperature: 2.1 }).success).toBe(false);
	expect(HostedModelAdapterConfigSchema.safeParse({ ...candidate, top_p: 0.95 }).success).toBe(false);
	expect(HostedModelAdapterConfigSchema.safeParse({ ...candidate, top_k: 20 }).success).toBe(false);
	expect(HostedModelAdapterConfigSchema.safeParse({
		...candidate,
		billing: { ...candidate.billing, input_usd_per_million_tokens: -1 },
	}).success).toBe(false);
});

it("sends only the configured temperature decoding control", async () => {
	const fetchCall = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
		model: "returned-model",
		choices: [{ message: { content: "completion" } }],
		usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
	}));
	await hostedProvider(0.6).complete({ productionStep: "main_story_write", system: "system", user: "prompt" });
	const body = fetchCall.mock.calls[0]?.[1]?.body;
	if (typeof body !== "string") throw new Error("Expected request body to be JSON text");
	expect(JSON.parse(body) as unknown).toMatchObject({ temperature: 0.6 });
	expect(JSON.parse(body) as Record<string, unknown>).not.toHaveProperty("top_p");
	expect(JSON.parse(body) as Record<string, unknown>).not.toHaveProperty("top_k");
});

it("maps strict hosted provenance, usage, and calculated billing", async () => {
	const fetchCall = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
		model: "returned-model",
		choices: [{ message: { content: "completion" } }],
		usage: { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 },
	}));

	await expect(hostedProvider().complete({
		productionStep: "main_story_write",
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
	const body = fetchCall.mock.calls[0]?.[1]?.body;
	if (typeof body !== "string") throw new Error("Expected request body to be JSON text");
	expect(JSON.parse(body) as unknown).toEqual({
		model: "requested-model",
		messages: [
			{ role: "system", content: "system" },
			{ role: "user", content: "prompt" },
		],
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
			completion_tokens_details: { reasoning_tokens: 5, audio_tokens: 0 },
		},
		service_tier: "default",
		system_fingerprint: "fp_verify",
	}));

	await expect(hostedProvider().complete({
		productionStep: "main_story_write",
		system: "system",
		user: "prompt",
	})).resolves.toMatchObject({ text: "completion", model: "returned-model" });
});

it("keeps hosted completion text byte-for-byte", async () => {
	const malformed = '{"summary":"called it "good" today"}';
	vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
		model: "returned-model",
		choices: [{ message: { content: malformed } }],
		usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
	}));

	const completion = await hostedProvider().complete({
		productionStep: "main_story_write",
		system: "system",
		user: "prompt",
	});
	expect(completion.text).toBe(malformed);
});

it.each([408, 409, 425, 429, 500, 599])("classifies HTTP %i as retryable", async (status) => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status }));
	await expect(hostedProvider().complete({ productionStep: "main_story_write", system: "s", user: "u" }))
		.rejects.toBeInstanceOf(OpenAiCompatibleRetryableError);
});

it.each([400, 401, 403, 404, 422])("classifies HTTP %i as deterministic", async (status) => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status }));
	await expect(hostedProvider().complete({ productionStep: "main_story_write", system: "s", user: "u" }))
		.rejects.toBeInstanceOf(OpenAiCompatibleDeterministicError);
});

it.each([
	{},
	{ model: "m", choices: [] },
	{ model: "m", choices: [{ message: { content: "x" } }] },
	{ model: "m", choices: [{ message: { content: "x" } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 3 } },
])("rejects malformed hosted response %# without echoing it", async (candidate) => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(candidate));
	const error = await hostedProvider().complete({ productionStep: "main_story_write", system: "s", user: "u" })
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
