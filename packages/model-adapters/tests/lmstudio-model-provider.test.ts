import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	PRODUCTION_STEP_OUTPUT_CONTRACTS,
	LM_STUDIO_AUXILIARY_OBSERVATION_TIMEOUT_MS,
	LmStudioAdapterConfigSchema,
	LmStudioDeterministicError,
	LmStudioRetryableError,
	createLmStudioModelProvider,
	lmStudioSdkBaseUrl,
	type LmStudioInferenceConfig,
} from "../src/index";

const sdk = vi.hoisted(() => ({ constructor: vi.fn() }));

vi.mock("@lmstudio/sdk", () => ({ LMStudioClient: sdk.constructor }));

const LOCAL_TEMPERATURE = 0.6;
const PROVIDER_DEFAULT_INFERENCE: LmStudioInferenceConfig = {
	temperature: undefined,
	topP: undefined,
	topK: undefined,
	enableThinking: undefined,
};
const LOCAL_INFERENCE: LmStudioInferenceConfig = {
	...PROVIDER_DEFAULT_INFERENCE,
	temperature: LOCAL_TEMPERATURE,
	topP: 0.95,
	topK: 20,
	enableThinking: false,
};
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
	format: string;
	sizeBytes: number;
	vision: boolean;
	trainedForToolUse: boolean;
	getModelInfo: ReturnType<typeof vi.fn>;
	getContextLength: ReturnType<typeof vi.fn>;
	respond: ReturnType<typeof vi.fn>;
}

function result(overrides: Record<string, unknown> = {}) {
	return {
		content: '{"title":"native"}',
		reasoningContent: "",
		nonReasoningContent: '{"title":"native"}',
		modelInfo: {
			identifier: "response-qwen",
			modelKey: "qwen/qwen3.5-9b",
			path: "qwen/qwen3.5-9b",
			displayName: "Qwen 3.5 9B",
			format: "gguf",
			instanceReference: "response-instance",
			sizeBytes: 9_000,
			architecture: "qwen3",
			paramsString: "9B",
			quantization: { name: "Q4_K_M", bits: 4.5 },
			vision: true,
			trainedForToolUse: true,
		},
		stats: {
			stopReason: "eosFound",
			timeToFirstTokenSec: 0.125,
			totalTimeSec: 1.5,
			tokensPerSecond: 16.5,
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
		format: "gguf",
		sizeBytes: 9_000,
		vision: true,
		trainedForToolUse: true,
		getModelInfo: vi.fn().mockResolvedValue({
			identifier: "loaded-qwen",
			modelKey: "qwen/qwen3.5-9b",
			path: "qwen/qwen3.5-9b",
			displayName: "Qwen 3.5 9B",
			format: "gguf",
			instanceReference: "selected-instance",
			sizeBytes: 9_000,
			contextLength: 32_768,
			architecture: "qwen3",
			paramsString: "9B",
			quantization: { name: "Q4_K_M", bits: 4.5 },
			vision: true,
			trainedForToolUse: true,
		}),
		getContextLength: vi.fn().mockResolvedValue(32_768),
		respond: vi.fn().mockResolvedValue(result()),
		...overrides,
	};
}

function queueClient(
	models: readonly FakeModel[],
	dispose = vi.fn().mockResolvedValue(undefined),
	version = vi.fn().mockResolvedValue({ version: "0.3.24", build: 11 }),
) {
	const client = {
		llm: { listLoaded: vi.fn().mockResolvedValue(models) },
		system: { getLMStudioVersion: version },
		[Symbol.asyncDispose]: dispose,
	};
	sdk.constructor.mockImplementationOnce(function () {
		return client;
	});
	return client;
}

function provider(
	inference: LmStudioInferenceConfig = LOCAL_INFERENCE,
) {
	return createLmStudioModelProvider({
		baseUrl: "http://127.0.0.1:1234/v1",
		requestedModel: "qwen/qwen3.5-9b",
		inference,
		reasoningEffort: "provider_default",
		structuredOutputContracts: PRODUCTION_STEP_OUTPUT_CONTRACTS,
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

it("accepts independent LM Studio inference controls and rejects invalid values", () => {
	const candidate = {
		adapter: "lmstudio",
		model: "qwen/qwen3.5-9b",
		reasoning_effort: "provider_default",
	};
	expect(LmStudioAdapterConfigSchema.safeParse(candidate).success).toBe(true);
	expect(LmStudioAdapterConfigSchema.safeParse({
		...candidate,
		temperature: LOCAL_TEMPERATURE,
		top_p: 0.95,
		top_k: 20,
		enable_thinking: false,
	}).success).toBe(true);

	for (const invalid of [
		{ ...candidate, temperature: -0.1 },
		{ ...candidate, temperature: 2.1 },
		{ ...candidate, temperature: Number.NaN },
		{ ...candidate, sampling: { temperature: 1, top_p: 0.95, top_k: 20 } },
		{ ...candidate, top_p: -0.1 },
		{ ...candidate, top_p: 1.1 },
		{ ...candidate, top_k: 0 },
		{ ...candidate, top_k: 501 },
		{ ...candidate, top_k: 20.5 },
		{ ...candidate, enable_thinking: "false" },
	]) {
		expect(LmStudioAdapterConfigSchema.safeParse(invalid).success).toBe(false);
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

	const completion = await provider().complete(request);
	expect(completion).toMatchObject({
		text: '{"title":"native"}',
		provider: "lmstudio",
		model: "response-qwen",
		execution: "local_inference",
		token_usage: { measurement: "reported", input_tokens: 100, output_tokens: 25, total_tokens: 125 },
		external_billing: { classification: "none", amount_usd: 0, reason: "local_inference" },
	});
	expect(completion.runtime_evidence).toEqual({
		execution_context: {
			client_sdk_release: { state: "observed", value: "1.5.0" },
			provider_runtime_identity: { state: "unknown", reason: "not_reported" },
			provider_runtime_version: { state: "observed", value: "0.3.24" },
			provider_runtime_build: { state: "observed", value: 11 },
			provider_service_tier: { state: "unknown", reason: "not_applicable" },
			selected_model: {
				requested_identity: { state: "observed", value: "qwen/qwen3.5-9b" },
				identifier: { state: "observed", value: "loaded-qwen" },
				model_key: { state: "observed", value: "qwen/qwen3.5-9b" },
				path: { state: "observed", value: "qwen/qwen3.5-9b" },
				display_name: { state: "observed", value: "Qwen 3.5 9B" },
				format: { state: "observed", value: "gguf" },
				instance_reference: { state: "observed", value: "selected-instance" },
				size_bytes: { state: "observed", value: 9_000 },
				architecture: { state: "observed", value: "qwen3" },
				parameter_count_description: { state: "observed", value: "9B" },
				quantization_name: { state: "observed", value: "Q4_K_M" },
				quantization_bits: { state: "observed", value: 4.5 },
				vision_capable: { state: "observed", value: true },
				trained_for_tool_use: { state: "observed", value: true },
			},
			response_model: {
				requested_identity: { state: "observed", value: "qwen/qwen3.5-9b" },
				identifier: { state: "observed", value: "response-qwen" },
				model_key: { state: "observed", value: "qwen/qwen3.5-9b" },
				path: { state: "observed", value: "qwen/qwen3.5-9b" },
				display_name: { state: "observed", value: "Qwen 3.5 9B" },
				format: { state: "observed", value: "gguf" },
				instance_reference: { state: "observed", value: "response-instance" },
				size_bytes: { state: "observed", value: 9_000 },
				architecture: { state: "observed", value: "qwen3" },
				parameter_count_description: { state: "observed", value: "9B" },
				quantization_name: { state: "observed", value: "Q4_K_M" },
				quantization_bits: { state: "observed", value: 4.5 },
				vision_capable: { state: "observed", value: true },
				trained_for_tool_use: { state: "observed", value: true },
			},
			context_length: { state: "observed", value: 32_768 },
			requested_reasoning_posture: { state: "observed", value: "thinking_disabled" },
			effective_reasoning_setting: { state: "externally_controlled", reason: "provider_controlled" },
			speculative_draft_model_identity: { state: "unknown", reason: "not_reported" },
		},
		prediction_observation: {
			provider_response_id: { state: "unknown", reason: "not_applicable" },
			stop_reason: { state: "observed", value: "eosFound" },
			time_to_first_token_ms: { state: "observed", value: 125 },
			total_time_ms: { state: "observed", value: 1_500 },
			tokens_per_second: { state: "observed", value: 16.5 },
			speculative_total_tokens: { state: "unknown", reason: "not_reported" },
			speculative_accepted_tokens: { state: "unknown", reason: "not_reported" },
			speculative_rejected_tokens: { state: "unknown", reason: "not_reported" },
			speculative_ignored_tokens: { state: "unknown", reason: "not_reported" },
			reasoning_content_present: { state: "observed", value: false },
		},
	});
	expect(sdk.constructor).toHaveBeenCalledWith({ baseUrl: "ws://127.0.0.1:1234" });
	expect(client.llm.listLoaded).toHaveBeenCalledOnce();
	expect(model.respond).toHaveBeenCalledWith(
		[
			{ role: "system", content: "system constraints" },
			{ role: "user", content: "main story prompt" },
		],
		expect.objectContaining({
			temperature: LOCAL_TEMPERATURE,
			topPSampling: 0.95,
			topKSampling: 20,
			enableThinking: false,
			structured: {
				type: "json",
				jsonSchema: PRODUCTION_STEP_OUTPUT_CONTRACTS.main_story_write.schema,
			},
		}),
	);
	const options = model.respond.mock.calls[0]?.[1] as Record<string, unknown>;
	expect(options.signal).toBeInstanceOf(AbortSignal);
	expect(options).toHaveProperty("temperature", LOCAL_TEMPERATURE);
	expect(options).toHaveProperty("topPSampling", 0.95);
	expect(options).toHaveProperty("topKSampling", 20);
	expect(options).toHaveProperty("enableThinking", false);
	expect(options).not.toHaveProperty("reasoningEffort");
	expect(options).not.toHaveProperty("reasoning_effort");
	expect(options).not.toHaveProperty("raw");
	expect(client[Symbol.asyncDispose]).toHaveBeenCalledOnce();
});

it.each(["version", "model_info", "context_length"] as const)(
	"isolates %s observation failure from successful inference",
	async (failure) => {
		const model = loadedModel({
			...(failure === "model_info" ? { getModelInfo: vi.fn().mockRejectedValue(new Error("info unavailable")) } : {}),
			...(failure === "context_length" ? { getContextLength: vi.fn().mockRejectedValue(new Error("context unavailable")) } : {}),
		});
		queueClient(
			[model],
			vi.fn().mockResolvedValue(undefined),
			failure === "version"
				? vi.fn().mockRejectedValue(new Error("version unavailable"))
				: vi.fn().mockResolvedValue({ version: "0.3.24", build: 11 }),
		);
		const completion = await provider().complete(request);
		expect(completion.model).toBe("response-qwen");
		const context = completion.runtime_evidence!.execution_context;
		expect(context.provider_runtime_version).toEqual(failure === "version"
			? { state: "unknown", reason: "observation_failed" }
			: { state: "observed", value: "0.3.24" });
		expect(context.selected_model.instance_reference).toEqual(failure === "model_info"
			? { state: "unknown", reason: "observation_failed" }
			: { state: "observed", value: "selected-instance" });
		expect(context.selected_model.architecture).toEqual(failure === "model_info"
			? { state: "unknown", reason: "observation_failed" }
			: { state: "observed", value: "qwen3" });
		expect(context.context_length).toEqual(failure === "context_length"
			? { state: "unknown", reason: "observation_failed" }
			: { state: "observed", value: 32_768 });
	},
);

it("bounds auxiliary observations without changing successful inference", async () => {
	vi.useFakeTimers();
	const never = vi.fn(() => new Promise<never>(() => undefined));
	const model = loadedModel({
		getModelInfo: never,
		getContextLength: never,
	});
	queueClient([model], vi.fn().mockResolvedValue(undefined), never);
	const completionPromise = provider().complete(request);
	await vi.advanceTimersByTimeAsync(LM_STUDIO_AUXILIARY_OBSERVATION_TIMEOUT_MS);
	const completion = await completionPromise;
	expect(completion.model).toBe("response-qwen");
	expect(completion.runtime_evidence?.execution_context).toMatchObject({
		provider_runtime_version: { state: "unknown", reason: "observation_failed" },
		provider_runtime_build: { state: "unknown", reason: "observation_failed" },
		selected_model: {
			instance_reference: { state: "unknown", reason: "observation_failed" },
			architecture: { state: "unknown", reason: "observation_failed" },
			parameter_count_description: { state: "unknown", reason: "observation_failed" },
			quantization_name: { state: "unknown", reason: "observation_failed" },
			quantization_bits: { state: "unknown", reason: "observation_failed" },
		},
		context_length: { state: "unknown", reason: "observation_failed" },
	});
});

it("normalizes invalid and missing runtime observations instead of retaining false precision", async () => {
	const model = loadedModel({
		displayName: " ",
		sizeBytes: -1,
		respond: vi.fn().mockResolvedValue(result({
			modelInfo: {
				identifier: "response-qwen",
				modelKey: " ",
				path: "qwen/qwen3.5-9b",
				displayName: "Qwen",
				format: "gguf",
				instanceReference: "response-instance",
				sizeBytes: Number.NaN,
			},
			stats: {
				stopReason: "eosFound",
				promptTokensCount: 1,
				predictedTokensCount: 1,
				totalTokensCount: 2,
				timeToFirstTokenSec: Number.NaN,
				totalTimeSec: -1,
				tokensPerSecond: Number.POSITIVE_INFINITY,
				totalDraftTokensCount: 5,
				acceptedDraftTokensCount: 1,
				rejectedDraftTokensCount: 1,
				ignoredDraftTokensCount: 1,
			},
		})),
	});
	queueClient([model], vi.fn().mockResolvedValue(undefined), vi.fn().mockResolvedValue({ version: " ", build: -1 }));
	const evidence = (await provider().complete(request)).runtime_evidence!;
	expect(evidence.execution_context).toMatchObject({
		provider_runtime_version: { state: "unknown", reason: "not_reported" },
		provider_runtime_build: { state: "unknown", reason: "not_reported" },
		selected_model: {
			display_name: { state: "unknown", reason: "not_reported" },
			size_bytes: { state: "unknown", reason: "not_reported" },
		},
		response_model: {
			model_key: { state: "unknown", reason: "not_reported" },
			size_bytes: { state: "unknown", reason: "not_reported" },
			architecture: { state: "unknown", reason: "not_reported" },
			parameter_count_description: { state: "unknown", reason: "not_reported" },
			quantization_name: { state: "unknown", reason: "not_reported" },
			quantization_bits: { state: "unknown", reason: "not_reported" },
			vision_capable: { state: "unknown", reason: "not_reported" },
			trained_for_tool_use: { state: "unknown", reason: "not_reported" },
		},
	});
	expect(evidence.prediction_observation).toMatchObject({
		time_to_first_token_ms: { state: "unknown", reason: "not_reported" },
		total_time_ms: { state: "unknown", reason: "not_reported" },
		tokens_per_second: { state: "unknown", reason: "not_reported" },
		speculative_total_tokens: { state: "unknown", reason: "not_reported" },
		speculative_accepted_tokens: { state: "unknown", reason: "not_reported" },
		speculative_rejected_tokens: { state: "unknown", reason: "not_reported" },
		speculative_ignored_tokens: { state: "unknown", reason: "not_reported" },
	});
});

it("omits every inference override for a provider-default evaluation candidate", async () => {
	const model = loadedModel();
	queueClient([model]);

	await provider(PROVIDER_DEFAULT_INFERENCE).complete(request);

	const options = model.respond.mock.calls[0]?.[1] as Record<string, unknown>;
	expect(options).not.toHaveProperty("temperature");
	expect(options).not.toHaveProperty("topPSampling");
	expect(options).not.toHaveProperty("topKSampling");
	expect(options).not.toHaveProperty("enableThinking");
	expect(options).toMatchObject({
		structured: {
			type: "json",
			jsonSchema: PRODUCTION_STEP_OUTPUT_CONTRACTS.main_story_write.schema,
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
	await vi.advanceTimersByTimeAsync(1_800_000);
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
	await vi.advanceTimersByTimeAsync(1_800_000);
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
