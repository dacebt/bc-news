import { afterEach, expect, it, vi } from "vitest";
import {
	HostedModelAdapterConfigSchema,
	LM_STUDIO_PRODUCTION_STEP_OUTPUT_CONTRACTS,
	LmStudioAdapterConfigSchema,
	OpenAiCompatibleDeterministicError,
	OpenAiCompatibleRetryableError,
	createOpenAiCompatibleModelProvider,
	openAiCompatibleChatCompletionsUrl,
	type LmStudioReasoningEffort,
} from "../src/index";

afterEach(() => vi.restoreAllMocks());

const LOCAL_SAMPLING = { temperature: 1, top_p: 0.95, top_k: 20 } as const;

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

it("requires finite in-range LM Studio sampling configuration", () => {
	const candidate = {
		adapter: "lmstudio",
		model: "local-model",
		sampling: LOCAL_SAMPLING,
		reasoning_effort: "none",
	};
	expect(LmStudioAdapterConfigSchema.safeParse(candidate).success).toBe(true);
	expect(LmStudioAdapterConfigSchema.safeParse({ ...candidate, sampling: undefined }).success).toBe(false);
	expect(LmStudioAdapterConfigSchema.safeParse({ ...candidate, sampling: { ...LOCAL_SAMPLING, temperature: 2.1 } }).success).toBe(false);
	expect(LmStudioAdapterConfigSchema.safeParse({ ...candidate, sampling: { ...LOCAL_SAMPLING, top_p: Number.NaN } }).success).toBe(false);
	expect(LmStudioAdapterConfigSchema.safeParse({ ...candidate, sampling: { ...LOCAL_SAMPLING, top_k: -1 } }).success).toBe(false);
	expect(LmStudioAdapterConfigSchema.safeParse({ ...candidate, sampling: { ...LOCAL_SAMPLING, top_k: 1.5 } }).success).toBe(false);
});

it.each([
	"provider_default",
	"none",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
] as const)("accepts LM Studio reasoning effort %s", (reasoningEffort) => {
	const candidate = {
		adapter: "lmstudio",
		model: "local-model",
		sampling: LOCAL_SAMPLING,
		reasoning_effort: reasoningEffort,
	};
	expect(LmStudioAdapterConfigSchema.safeParse(candidate).success).toBe(true);
});

it("rejects missing or unsupported LM Studio reasoning effort", () => {
	const candidate = {
		adapter: "lmstudio",
		model: "local-model",
		sampling: LOCAL_SAMPLING,
	};
	expect(LmStudioAdapterConfigSchema.safeParse(candidate).success).toBe(false);
	expect(LmStudioAdapterConfigSchema.safeParse({ ...candidate, reasoning_effort: "maximum" }).success).toBe(false);
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

function localProvider(reasoningEffort: LmStudioReasoningEffort = "none") {
	return createOpenAiCompatibleModelProvider({
		execution: "local_inference",
		baseUrl: "http://127.0.0.1:1234/v1",
		requestedModel: "requested-local-model",
		sampling: LOCAL_SAMPLING,
		reasoningEffort,
		structuredOutputContracts: LM_STUDIO_PRODUCTION_STEP_OUTPUT_CONTRACTS,
	});
}

function mockLocalCompletion(content: string) {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
		model: "returned-local-model",
		choices: [{ message: { content } }],
	}));
}

async function completeLocalText(content: string): Promise<string> {
	mockLocalCompletion(content);
	const completion = await localProvider().complete({
		productionStep: "main_story_write",
		system: "system",
		user: "prompt",
	});
	return completion.text;
}

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

it.each([
	["none", "none"],
	["provider_default", undefined],
] as const)("maps LM Studio reasoning effort %s to the local request", async (reasoningEffort, expected) => {
	const fetchCall = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
		model: "returned-local-model",
		choices: [{ message: { content: "completion" } }],
	}));
	await localProvider(reasoningEffort).complete({
		productionStep: "main_story_write",
		system: "system",
		user: "prompt",
	});
	const body = fetchCall.mock.calls[0]?.[1]?.body;
	if (typeof body !== "string") throw new Error("Expected request body to be JSON text");
	const parsed = JSON.parse(body) as Record<string, unknown>;
	if (expected === undefined) {
		expect(parsed).not.toHaveProperty("reasoning_effort");
	} else {
		expect(parsed.reasoning_effort).toBe(expected);
	}
});

it.each([
	["main_story_write", "main_story_write_output"],
	["main_story_copyedit", "main_story_copyedit_output"],
	["announcements_write", "announcements_write_output"],
	["announcements_copyedit", "announcements_copyedit_output"],
] as const)("selects the %s structured-output contract by production step", async (productionStep, expectedName) => {
	const fetchCall = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
		model: "returned-local-model",
		choices: [{ message: { content: "completion" } }],
	}));

	await localProvider().complete({ productionStep, system: "system", user: "prompt" });
	const body = fetchCall.mock.calls[0]?.[1]?.body;
	if (typeof body !== "string") throw new Error("Expected request body to be JSON text");
	const parsed = JSON.parse(body) as {
		response_format?: { json_schema?: { name?: string } };
	};
	expect(parsed.response_format?.json_schema?.name).toBe(expectedName);
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
		productionStep: "main_story_write",
		system: "system",
		user: "prompt",
	})).resolves.toMatchObject({ text: "completion", model: "returned-model" });
});

it.each([
	{ variant: "reasoning", reasoningMetadata: { reasoning: "private reasoning" } },
	{ variant: "reasoning_content", reasoningMetadata: { reasoning_content: "private reasoning" } },
])("accepts observed LM Studio $variant local metadata", async ({ reasoningMetadata }) => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
		id: "chatcmpl-local",
		object: "chat.completion",
		created: 1_785_882_800,
		model: "returned-local-model",
		choices: [{
			index: 0,
			message: {
				role: "assistant",
				content: "local completion",
				...reasoningMetadata,
				tool_calls: [],
			},
			finish_reason: "stop",
			logprobs: null,
		}],
		usage: { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 },
		system_fingerprint: "local-fingerprint",
		stats: {},
	}));

	await expect(localProvider().complete({
		productionStep: "main_story_write",
		system: "system",
		user: "prompt",
	})).resolves.toEqual({
		text: "local completion",
		provider: "lmstudio",
		model: "returned-local-model",
		execution: "local_inference",
		token_usage: { measurement: "reported", input_tokens: 100, output_tokens: 25, total_tokens: 125 },
		external_billing: { classification: "none", amount_usd: 0, reason: "local_inference" },
	});
});

it("repairs paired unescaped prose quotes in local JSON string values", async () => {
	const malformed = '{"headline":"A herald called it "the first victory" today","summary":"Players named it "wildly ambitious" after launch","tags":["news"]}';
	const expected = '{"headline":"A herald called it \\"the first victory\\" today","summary":"Players named it \\"wildly ambitious\\" after launch","tags":["news"]}';

	await expect(completeLocalText(malformed)).resolves.toBe(expected);
	expect(JSON.parse(expected)).toEqual({
		headline: 'A herald called it "the first victory" today',
		summary: 'Players named it "wildly ambitious" after launch',
		tags: ["news"],
	});
});

it("repairs local JSON quotes after Unicode and emoji without shifting the candidate position", async () => {
	const malformed = '{"summary":"Café 🎉 called it "a triumph" today"}';
	const expected = '{"summary":"Café 🎉 called it \\"a triumph\\" today"}';

	await expect(completeLocalText(malformed)).resolves.toBe(expected);
});

it("returns valid local JSON without additional normalization", async () => {
	const valid = '{\n  "summary": "already \\"quoted\\""\n}';
	await expect(completeLocalText(valid)).resolves.toBe(valid);
});

it.each([
	'{"first":"one" "second":"two"}',
	'["one" "two"]',
	'{"summary":"a stray " quote"}',
	'Here is the result: {"summary":"called it "good" today"}',
	'```json\n{"summary":"called it "good" today"}\n```',
	'{"bad "quoted key" name":"value"}',
	'{"summary":"x" junk "y"}',
	'{"summary":"x" true "y"}',
	'{"summary":"x" 123 "y"}',
	'{"summary":"x" : "y"}',
	'{"summary":"x " : , " y"}',
])("leaves unsupported local JSON corruption unchanged: %s", async (malformed) => {
	await expect(completeLocalText(malformed)).resolves.toBe(malformed);
});

it("repairs at most 64 quote candidates in local JSON", async () => {
	const value = Array.from(
		{ length: 32 },
		(_, index) => `item ${index} "quoted phrase" continued`,
	).join("; ");
	const malformed = JSON.stringify({ summary: value }).replaceAll('\\"', '"');
	const expected = JSON.stringify({ summary: value });

	await expect(completeLocalText(malformed)).resolves.toBe(expected);
});

it("leaves local JSON requiring more than 64 quote repairs unchanged", async () => {
	const pairedValue = Array.from(
		{ length: 32 },
		(_, index) => `item ${index} "quoted phrase" continued`,
	).join("; ");
	const malformed = `{"summary":"${pairedValue}; final "unpaired phrase" continued"}`;

	await expect(completeLocalText(malformed)).resolves.toBe(malformed);
});

it("keeps hosted malformed completion text byte-for-byte", async () => {
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

it.each([
	{
		model: "m",
		choices: [{ message: { content: "x", tool_calls: [{ id: "call-1" }] } }],
	},
	{
		model: "m",
		choices: [{ message: { content: "x" } }],
		stats: { tokens_per_second: 10 },
	},
	{
		model: "m",
		choices: [{ message: { content: "x" } }],
		invented: true,
	},
	{
		model: "m",
		choices: [{ message: { content: "x", invented: true } }],
	},
	{
		model: "m",
		choices: [{ message: { content: "x", reasoning: "one", reasoning_content: "two" } }],
	},
])("rejects unsupported LM Studio local metadata %#", async (candidate) => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(candidate));
	await expect(localProvider().complete({ productionStep: "main_story_write", system: "s", user: "u" }))
		.rejects.toMatchObject({ code: "openai_compatible_response_contract_rejected" });
});

it("keeps LM Studio response metadata outside the hosted contract", async () => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
		model: "m",
		choices: [{ message: { content: "x", reasoning_content: "private", tool_calls: [] } }],
		usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
		stats: {},
	}));

	await expect(hostedProvider().complete({ productionStep: "main_story_write", system: "s", user: "u" }))
		.rejects.toMatchObject({ code: "openai_compatible_response_contract_rejected" });
});

it.each([
	{ model: "m", invented: true, choices: [{ message: { content: "x" } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
	{ model: "m", choices: [{ invented: true, message: { content: "x" } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
	{ model: "m", choices: [{ message: { content: "x", invented: true } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
	{ model: "m", choices: [{ message: { content: "x" } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, invented: true } },
])("rejects invented completion-envelope fields %#", async (candidate) => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(candidate));
	await expect(hostedProvider().complete({ productionStep: "main_story_write", system: "s", user: "u" }))
		.rejects.toMatchObject({ code: "openai_compatible_response_contract_rejected" });
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
	{ model: "m", choices: [{ message: { content: "x" } }, { message: { content: "y" } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
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
