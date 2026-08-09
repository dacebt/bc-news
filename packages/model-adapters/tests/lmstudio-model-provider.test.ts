import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	LM_STUDIO_PRODUCTION_STEP_OUTPUT_CONTRACTS,
	LmStudioAdapterConfigSchema,
	LmStudioDeterministicError,
	LmStudioRetryableError,
	createLmStudioModelProvider,
	lmStudioSdkBaseUrl,
	type LmStudioSamplingConfig,
} from "../src/index";

const sdk = vi.hoisted(() => ({ constructor: vi.fn() }));

vi.mock("@lmstudio/sdk", () => ({ LMStudioClient: sdk.constructor }));

const LOCAL_SAMPLING = { temperature: 1, top_p: 0.95, top_k: 20 } as const;
const request = {
	productionStep: "main_story_write" as const,
	system: "system constraints",
	user: "main story prompt",
};

interface FakeModel {
	identifier: string;
	modelKey: string;
	path: string;
	displayName: string;
	respond: ReturnType<typeof vi.fn>;
}

function result(overrides: Record<string, unknown> = {}) {
	return {
		content: '{"title":"native"}',
		reasoningContent: "",
		nonReasoningContent: '{"title":"native"}',
		modelInfo: { identifier: "loaded-qwen" },
		stats: {
			stopReason: "eosFound",
			promptTokensCount: 100,
			predictedTokensCount: 25,
			totalTokensCount: 125,
		},
		...overrides,
	};
}

function loadedModel(overrides: Partial<FakeModel> = {}): FakeModel {
	return {
		identifier: "loaded-qwen",
		modelKey: "qwen/qwen3.5-9b",
		path: "qwen/qwen3.5-9b",
		displayName: "Qwen 3.5 9B",
		respond: vi.fn().mockResolvedValue(result()),
		...overrides,
	};
}

function queueClient(models: readonly FakeModel[], dispose = vi.fn().mockResolvedValue(undefined)) {
	const client = {
		llm: { listLoaded: vi.fn().mockResolvedValue(models) },
		[Symbol.asyncDispose]: dispose,
	};
	sdk.constructor.mockImplementationOnce(function () {
		return client;
	});
	return client;
}

function provider(
	options: { readonly sampling?: LmStudioSamplingConfig } = { sampling: LOCAL_SAMPLING },
) {
	return createLmStudioModelProvider({
		baseUrl: "http://127.0.0.1:1234/v1",
		requestedModel: "qwen/qwen3.5-9b",
		...(options.sampling === undefined ? {} : { sampling: options.sampling }),
		reasoningEffort: "provider_default",
		structuredOutputContracts: LM_STUDIO_PRODUCTION_STEP_OUTPUT_CONTRACTS,
	});
}

beforeEach(() => sdk.constructor.mockReset());
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

it("accepts only provider-default reasoning for current LM Studio configuration", () => {
	const candidate = {
		adapter: "lmstudio",
		model: "qwen/qwen3.5-9b",
		reasoning_effort: "provider_default",
	};
	expect(LmStudioAdapterConfigSchema.safeParse(candidate).success).toBe(true);
	for (const effort of ["none", "minimal", "low", "medium", "high", "xhigh"]) {
		expect(LmStudioAdapterConfigSchema.safeParse({ ...candidate, reasoning_effort: effort }).success).toBe(false);
	}
});

it("accepts omitted or complete sampling and rejects partial or invalid sampling", () => {
	const candidate = {
		adapter: "lmstudio",
		model: "qwen/qwen3.5-9b",
		reasoning_effort: "provider_default",
	};
	expect(LmStudioAdapterConfigSchema.safeParse(candidate).success).toBe(true);
	expect(LmStudioAdapterConfigSchema.safeParse({ ...candidate, sampling: LOCAL_SAMPLING }).success).toBe(true);

	for (const sampling of [
		{ temperature: 1, top_p: 0.95 },
		{ temperature: 1, top_k: 20 },
		{ top_p: 0.95, top_k: 20 },
		{ temperature: 3, top_p: 0.95, top_k: 20 },
		{ temperature: 1, top_p: 1.1, top_k: 20 },
		{ temperature: 1, top_p: 0.95, top_k: -1 },
	]) {
		expect(LmStudioAdapterConfigSchema.safeParse({ ...candidate, sampling }).success).toBe(false);
	}
});

it.each([
	["http://127.0.0.1:1234", "ws://127.0.0.1:1234"],
	["http://127.0.0.1:1234/v1", "ws://127.0.0.1:1234"],
	["https://lmstudio.example/v1/", "wss://lmstudio.example"],
])("converts canonical LM Studio URL %s", (baseUrl, expected) => {
	expect(lmStudioSdkBaseUrl(baseUrl)).toBe(expected);
});

it.each([
	"ftp://localhost/v1",
	"http://user:secret@localhost/v1",
	"http://localhost/v1?mode=test",
	"http://localhost/models",
	" http://localhost/v1",
])("rejects unsafe or ambiguous LM Studio base URL %s", (baseUrl) => {
	expect(() => lmStudioSdkBaseUrl(baseUrl)).toThrow(LmStudioDeterministicError);
});

it("uses the exact loaded model, native structured prediction, truthful evidence, and cleanup", async () => {
	const model = loadedModel();
	const client = queueClient([model]);

	await expect(provider().complete(request)).resolves.toEqual({
		text: '{"title":"native"}',
		provider: "lmstudio",
		model: "loaded-qwen",
		execution: "local_inference",
		token_usage: { measurement: "reported", input_tokens: 100, output_tokens: 25, total_tokens: 125 },
		external_billing: { classification: "none", amount_usd: 0, reason: "local_inference" },
	});
	expect(sdk.constructor).toHaveBeenCalledWith({ baseUrl: "ws://127.0.0.1:1234" });
	expect(client.llm.listLoaded).toHaveBeenCalledOnce();
	expect(model.respond).toHaveBeenCalledWith(
		[
			{ role: "system", content: "system constraints" },
			{ role: "user", content: "main story prompt" },
		],
		expect.objectContaining({
			temperature: 1,
			topPSampling: 0.95,
			topKSampling: 20,
			structured: {
				type: "json",
				jsonSchema: LM_STUDIO_PRODUCTION_STEP_OUTPUT_CONTRACTS.main_story_write.schema,
			},
		}),
	);
	const options = model.respond.mock.calls[0]?.[1] as Record<string, unknown>;
	expect(options.signal).toBeInstanceOf(AbortSignal);
	expect(options).toHaveProperty("temperature", 1);
	expect(options).toHaveProperty("topPSampling", 0.95);
	expect(options).toHaveProperty("topKSampling", 20);
	expect(options).not.toHaveProperty("reasoningEffort");
	expect(options).not.toHaveProperty("reasoning_effort");
	expect(options).not.toHaveProperty("raw");
	expect(client[Symbol.asyncDispose]).toHaveBeenCalledOnce();
});

it("omits every SDK sampling property for provider-default sampling", async () => {
	const model = loadedModel();
	queueClient([model]);

	await provider({}).complete(request);

	const options = model.respond.mock.calls[0]?.[1] as Record<string, unknown>;
	expect(options).not.toHaveProperty("temperature");
	expect(options).not.toHaveProperty("topPSampling");
	expect(options).not.toHaveProperty("topKSampling");
	expect(options).toMatchObject({
		structured: {
			type: "json",
			jsonSchema: LM_STUDIO_PRODUCTION_STEP_OUTPUT_CONTRACTS.main_story_write.schema,
		},
	});
	expect(options.signal).toBeInstanceOf(AbortSignal);
});

it("never loads and rejects zero or ambiguous loaded-model matches", async () => {
	const unmatched = loadedModel({ modelKey: "other", path: "other" });
	queueClient([unmatched]);
	await expect(provider().complete(request)).rejects.toMatchObject({
		code: "lmstudio_loaded_model_not_found",
	});

	const first = loadedModel({ identifier: "first", modelKey: "qwen/qwen3.5-9b" });
	const second = loadedModel({ identifier: "second", path: "qwen/qwen3.5-9b" });
	queueClient([first, second]);
	await expect(provider().complete(request)).rejects.toMatchObject({
		code: "lmstudio_loaded_model_ambiguous",
	});
	expect(first.respond).not.toHaveBeenCalled();
	expect(second.respond).not.toHaveBeenCalled();
});

it("selects only native non-reasoning content for the application parser", async () => {
	const answer = '{"title":"native"}';
	const model = loadedModel({
		respond: vi.fn().mockResolvedValue(result({
			content: `Thinking Process:\ninspect the request\n__LM_STUDIO_INTERNAL_LSEP__${answer}`,
			reasoningContent: "Thinking Process:\ninspect the request\n",
			nonReasoningContent: answer,
		})),
	});
	queueClient([model]);
	await expect(provider().complete(request)).resolves.toMatchObject({ text: answer });
});

it("preserves native non-reasoning content byte-for-byte for the application parser", async () => {
	const malformed = '{"summary":"called it "good" today"}';
	const model = loadedModel({
		respond: vi.fn().mockResolvedValue(result({
			content: malformed,
			nonReasoningContent: malformed,
		})),
	});
	queueClient([model]);
	await expect(provider().complete(request)).resolves.toMatchObject({ text: malformed });
});

it("marks wholly absent usage unavailable and rejects partial or inconsistent counts", async () => {
	const absent = loadedModel({
		respond: vi.fn().mockResolvedValue(result({ stats: { stopReason: "eosFound" } })),
	});
	queueClient([absent]);
	await expect(provider().complete(request)).resolves.toMatchObject({
		token_usage: { measurement: "unavailable" },
	});

	for (const stats of [
		{ stopReason: "eosFound", promptTokensCount: 1 },
		{ stopReason: "eosFound", promptTokensCount: 1, predictedTokensCount: 1, totalTokensCount: 3 },
	]) {
		const invalid = loadedModel({ respond: vi.fn().mockResolvedValue(result({ stats })) });
		queueClient([invalid]);
		await expect(provider().complete(request)).rejects.toMatchObject({
			code: "lmstudio_usage_contract_rejected",
		});
	}
});

it.each(["toolCalls", "maxPredictedTokensReached", "contextLengthReached"])(
	"rejects incomplete stop reason %s deterministically",
	async (stopReason) => {
		const model = loadedModel({ respond: vi.fn().mockResolvedValue(result({ stats: { stopReason } })) });
		queueClient([model]);
		await expect(provider().complete(request)).rejects.toMatchObject({
			code: "lmstudio_completion_incomplete",
		});
	},
);

it("classifies timeout-driven user stop as retryable", async () => {
	vi.useFakeTimers();
	const model = loadedModel({
		respond: vi.fn().mockImplementation((_chat, options: { signal: AbortSignal }) =>
			new Promise((resolve) => options.signal.addEventListener("abort", () =>
				resolve(result({ stats: { stopReason: "userStopped" } })),
			))),
	});
	queueClient([model]);
	const rejection = expect(provider().complete(request)).rejects.toMatchObject({
		code: "lmstudio_timeout",
	});
	await vi.advanceTimersByTimeAsync(600_000);
	await rejection;
});

it("classifies a completion that resolves successfully after abort as timed out", async () => {
	vi.useFakeTimers();
	const model = loadedModel({
		respond: vi.fn().mockImplementation((_chat, options: { signal: AbortSignal }) =>
			new Promise((resolve) => options.signal.addEventListener("abort", () =>
				resolve(result({ stats: { stopReason: "eosFound" } })),
			))),
	});
	queueClient([model]);
	const rejection = expect(provider().complete(request)).rejects.toMatchObject({
		code: "lmstudio_timeout",
	});
	await vi.advanceTimersByTimeAsync(600_000);
	await rejection;
});

it("classifies unknown SDK failures as retryable and still disposes the client", async () => {
	const model = loadedModel({ respond: vi.fn().mockRejectedValue(new Error("socket closed")) });
	const client = queueClient([model]);
	await expect(provider().complete(request)).rejects.toBeInstanceOf(LmStudioRetryableError);
	expect(client[Symbol.asyncDispose]).toHaveBeenCalledOnce();
});

it("preserves a deterministic operation code when client cleanup also fails", async () => {
	const operationFailureCode = "lmstudio_loaded_model_not_found";
	queueClient(
		[loadedModel({ modelKey: "other", path: "other" })],
		vi.fn().mockRejectedValue(new Error("cleanup failed")),
	);
	const failure = await provider().complete(request).catch((cause: unknown) => cause);
	expect(failure).toBeInstanceOf(LmStudioDeterministicError);
	expect(failure).toMatchObject({ code: operationFailureCode });
	expect((failure as Error).cause).toBeInstanceOf(AggregateError);
	expect(((failure as Error).cause as AggregateError).errors).toHaveLength(2);
});

it("preserves a retryable operation code when client cleanup also fails", async () => {
	queueClient(
		[loadedModel({ respond: vi.fn().mockRejectedValue(new Error("socket closed")) })],
		vi.fn().mockRejectedValue(new Error("cleanup failed")),
	);
	const failure = await provider().complete(request).catch((cause: unknown) => cause);
	expect(failure).toBeInstanceOf(LmStudioRetryableError);
	expect(failure).toMatchObject({ code: "lmstudio_sdk_failure" });
	expect((failure as Error).cause).toBeInstanceOf(AggregateError);
	expect(((failure as Error).cause as AggregateError).errors).toHaveLength(2);
});

it("classifies a standalone client cleanup failure as retryable", async () => {
	queueClient(
		[loadedModel()],
		vi.fn().mockRejectedValue(new Error("cleanup failed")),
	);
	await expect(provider().complete(request)).rejects.toMatchObject({
		code: "lmstudio_sdk_failure",
	});
});

it("creates and disposes a fresh client for every completion attempt", async () => {
	const first = queueClient([loadedModel()]);
	const second = queueClient([loadedModel()]);
	const localProvider = provider();
	await localProvider.complete(request);
	await localProvider.complete(request);
	expect(sdk.constructor).toHaveBeenCalledTimes(2);
	expect(first[Symbol.asyncDispose]).toHaveBeenCalledOnce();
	expect(second[Symbol.asyncDispose]).toHaveBeenCalledOnce();
});
