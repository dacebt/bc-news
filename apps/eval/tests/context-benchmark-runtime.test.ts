import { beforeEach, describe, expect, test, vi } from "vitest";

const lmStudio = vi.hoisted(() => ({
	constructor: vi.fn(),
	listLoaded: vi.fn(),
	load: vi.fn(),
	select: vi.fn(),
	dispose: vi.fn(),
}));

vi.mock("@lmstudio/sdk", () => ({
	LMStudioClient: class {
		readonly llm = {
			listLoaded: lmStudio.listLoaded,
			load: lmStudio.load,
			select: lmStudio.select,
		};

		constructor(options: unknown) {
			lmStudio.constructor(options);
		}

		async [Symbol.asyncDispose](): Promise<void> {
			await lmStudio.dispose();
		}
	},
}));

import {
	ContextBenchmarkRuntimeError,
	createLmStudioContextBenchmarkRuntime,
	lmStudioSdkBaseUrl,
} from "../src/context-benchmark-runtime";

beforeEach(() => {
	vi.clearAllMocks();
	lmStudio.dispose.mockResolvedValue(undefined);
});

function loadedModel(overrides: Record<string, unknown> = {}) {
	return {
		identifier: "qwen3-30b-a3b",
		modelKey: "qwen/qwen3-30b-a3b",
		path: "/models/qwen3-30b-a3b.gguf",
		displayName: "Qwen 3 30B A3B",
		getContextLength: vi.fn().mockResolvedValue(65_536),
		applyPromptTemplate: vi.fn().mockResolvedValue("templated prompt"),
		countTokens: vi.fn().mockResolvedValue(321),
		respond: vi.fn(),
		...overrides,
	};
}

async function expectRuntimeError(
	promise: Promise<unknown>,
	code: ContextBenchmarkRuntimeError["code"],
): Promise<void> {
	const error = await promise.catch((cause: unknown) => cause);
	expect(error).toBeInstanceOf(ContextBenchmarkRuntimeError);
	expect(error).toMatchObject({ code });
}

describe("LM Studio base URL", () => {
	test.each([
		["http://localhost:1234/v1", "ws://localhost:1234"],
		["http://127.0.0.1:1234/v1", "ws://127.0.0.1:1234"],
		["http://[::1]:1234/v1", "ws://[::1]:1234"],
		["http://192.168.1.20:1234/v1", "ws://192.168.1.20:1234"],
		["https://qwen.local:1234/v1", "wss://qwen.local:1234"],
	])("normalizes OpenAI URL %s for the SDK", (input, expected) => {
		expect(lmStudioSdkBaseUrl(input)).toBe(expected);
	});

	test.each([
		"",
		" http://localhost:1234/v1",
		"localhost:1234",
		"ftp://localhost:1234/v1",
		"http://user:secret@localhost:1234/v1",
		"http://localhost:1234/v1?token=secret",
		"http://localhost:1234/v1#fragment",
		"https://localhost:1234/api/",
	])("rejects malformed or decorated URL %j", (input) => {
		expect(() => lmStudioSdkBaseUrl(input)).toThrowError(
			expect.objectContaining({ code: "invalid_lmstudio_base_url" }),
		);
	});
});

describe("LM Studio context benchmark runtime", () => {
	test("adapts the only loaded Qwen and delegates template and token operations", async () => {
		const model = loadedModel();
		lmStudio.listLoaded.mockResolvedValue([model]);
		const runtime = createLmStudioContextBenchmarkRuntime("http://localhost:1234/v1");

		const adapted = await runtime.getOnlyLoadedQwen();

		expect(lmStudio.constructor).toHaveBeenCalledExactlyOnceWith({
			baseUrl: "ws://localhost:1234",
		});
		expect(adapted).toMatchObject({
			identifier: model.identifier,
			modelKey: model.modelKey,
			path: model.path,
			displayName: model.displayName,
			contextLength: 65_536,
		});
		await expect(adapted.applyPromptTemplate({ system: "house rules", user: "draft" })).resolves.toBe(
			"templated prompt",
		);
		expect(model.applyPromptTemplate).toHaveBeenCalledExactlyOnceWith([
			{ role: "system", content: "house rules" },
			{ role: "user", content: "draft" },
		]);
		await expect(adapted.countTokens("templated prompt")).resolves.toBe(321);
		expect(model.countTokens).toHaveBeenCalledExactlyOnceWith("templated prompt");
		expect(model.getContextLength).toHaveBeenCalledOnce();
		expect(lmStudio.load).not.toHaveBeenCalled();
		expect(lmStudio.select).not.toHaveBeenCalled();
		expect(model.respond).not.toHaveBeenCalled();
	});

	test("accepts Qwen identification from any exposed metadata field", async () => {
		const model = loadedModel({
			identifier: "local-model",
			modelKey: "local-model",
			path: "/models/local-model.gguf",
			displayName: "Qwen2.5 Coder 32B",
		});
		lmStudio.listLoaded.mockResolvedValue([model]);

		const adapted = await createLmStudioContextBenchmarkRuntime(
			"http://127.0.0.1:1234/v1",
		).getOnlyLoadedQwen();

		expect(adapted.displayName).toBe("Qwen2.5 Coder 32B");
	});

	test("rejects an empty loaded-model roster", async () => {
		lmStudio.listLoaded.mockResolvedValue([]);
		const runtime = createLmStudioContextBenchmarkRuntime("http://localhost:1234/v1");

		await expectRuntimeError(runtime.getOnlyLoadedQwen(), "no_loaded_llm");
	});

	test("rejects more than one loaded model even when Qwen is present", async () => {
		lmStudio.listLoaded.mockResolvedValue([
			loadedModel(),
			loadedModel({ identifier: "other", displayName: "Other model" }),
		]);
		const runtime = createLmStudioContextBenchmarkRuntime("http://localhost:1234/v1");

		await expectRuntimeError(runtime.getOnlyLoadedQwen(), "multiple_loaded_llms");
	});

	test("rejects a sole loaded model whose metadata does not identify Qwen", async () => {
		const model = loadedModel({
			identifier: "mistral-small",
			modelKey: "mistral-small",
			path: "/models/mistral-small.gguf",
			displayName: "Mistral Small",
		});
		lmStudio.listLoaded.mockResolvedValue([model]);
		const runtime = createLmStudioContextBenchmarkRuntime("http://localhost:1234/v1");

		await expectRuntimeError(runtime.getOnlyLoadedQwen(), "loaded_llm_not_qwen");
		expect(model.getContextLength).not.toHaveBeenCalled();
	});

	test("closes the SDK client at most once", async () => {
		const runtime = createLmStudioContextBenchmarkRuntime("http://localhost:1234/v1");

		await runtime.close();
		await runtime.close();

		expect(lmStudio.dispose).toHaveBeenCalledOnce();
	});
});
