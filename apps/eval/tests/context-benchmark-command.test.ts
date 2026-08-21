import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { REPRESENTATIVE_FIXTURE_PATH } from "../src/representative-fixture";
import { parseEvalCliCommand } from "../src/cli-options";
import { runContextBenchmark } from "../src/context-benchmark-command";
import { CONTEXT_BENCHMARK_LOADS } from "../src/context-benchmark-file";
import type {
	ContextBenchmarkModel,
	ContextBenchmarkPrompt,
	ContextBenchmarkRuntime,
} from "../src/context-benchmark-runtime";

const nativeSdk = vi.hoisted(() => ({
	constructor: vi.fn(),
	listLoaded: vi.fn(),
	respond: vi.fn(),
	dispose: vi.fn(),
}));

vi.mock("@lmstudio/sdk", () => ({
	LMStudioClient: class {
		readonly llm = { listLoaded: nativeSdk.listLoaded };

		constructor(options: unknown) {
			nativeSdk.constructor(options);
		}

		async [Symbol.asyncDispose](): Promise<void> {
			await nativeSdk.dispose();
		}
	},
}));

const MODEL = "qwen3-local";
const MODEL_METADATA = {
	identifier: MODEL,
	modelKey: "qwen3-local-key",
	path: "lmstudio-community/qwen3-local",
	displayName: "Qwen 3 Local",
	contextLength: 1_000_000,
} as const;

const MODEL_CONFIG = JSON.stringify({
	main_story_write: localStepConfig(MODEL, 0.7),
	announcements_write: localStepConfig(MODEL, 0.6),
});

const PROVIDER_DEFAULT_MODEL_CONFIG = JSON.stringify({
	main_story_write: providerDefaultLocalStepConfig(MODEL),
	announcements_write: providerDefaultLocalStepConfig(MODEL),
});

const RESPONSE_TEXT = {
	main_story_write: JSON.stringify({
		title: "Regional Chronicle",
		main_story: {
			headline: "Aryn Organizes a Dungeon Muster",
			lede: "Aryn organized a regional dungeon muster.",
			body: "**Aryn** invited the region to a dungeon crawl.\n\n**Archaelic** joined the group.",
		},
	}),
	announcements_write: JSON.stringify({
		announcements: [{ title: "Sailing Milestone", summary: "**KeyserSoze** reached level 75." }],
	}),
} as const;

type ProductionStep = keyof typeof RESPONSE_TEXT;
type NativeRequest = {
	readonly step: ProductionStep;
	readonly chat: readonly [
		{ readonly role: "system"; readonly content: string },
		{ readonly role: "user"; readonly content: string },
	];
	readonly options: {
		readonly temperature?: number;
		readonly topPSampling?: number;
		readonly topKSampling?: number;
		readonly enableThinking?: boolean;
		readonly structured: {
			readonly type: "json";
			readonly jsonSchema: Readonly<Record<string, unknown>>;
		};
	};
};

function localStepConfig(model: string, temperature: number) {
	return {
		adapter: "lmstudio",
		model,
		temperature,
		top_p: 0.95,
		top_k: 20,
		enable_thinking: false,
		reasoning_effort: "provider_default",
	};
}

function providerDefaultLocalStepConfig(model: string) {
	return {
		adapter: "lmstudio",
		model,
		reasoning_effort: "provider_default",
	};
}

function benchmarkEnvironment(modelConfig = MODEL_CONFIG) {
	return {
		MODEL_CONFIG: modelConfig,
		LMSTUDIO_BASE_URL: "http://127.0.0.1:1234/v1",
	};
}

function createRuntime() {
	const close = vi.fn(() => Promise.resolve());
	const model: ContextBenchmarkModel = {
		...MODEL_METADATA,
		applyPromptTemplate: (prompt: ContextBenchmarkPrompt) => Promise.resolve(JSON.stringify([
			{ role: "system", content: prompt.system },
			{ role: "user", content: prompt.user },
		])),
		countTokens: (text: string) => Promise.resolve(text.length),
	};
	const getOnlyLoadedQwen = vi.fn(() => Promise.resolve(model));
	const runtime: ContextBenchmarkRuntime = {
		getOnlyLoadedQwen,
		close,
	};
	return { runtime, close, getOnlyLoadedQwen };
}

function installNativeCompletions(input?: {
	readonly omitUsage?: boolean;
	readonly responseModel?: string;
}) {
	const steps: ProductionStep[] = CONTEXT_BENCHMARK_LOADS.flatMap(() => [
		"main_story_write",
		"announcements_write",
	]);
	const requests: NativeRequest[] = [];
	nativeSdk.respond.mockImplementation((chat: NativeRequest["chat"], options: NativeRequest["options"]) => {
		const step = steps[requests.length];
		if (step === undefined) throw new Error("Unexpected native LM Studio completion");
		requests.push({ step, chat, options });
		const promptTokens = JSON.stringify(chat).length + 7;
		const completionTokens = 11;
		return Promise.resolve({
			content: RESPONSE_TEXT[step],
			reasoningContent: "",
			nonReasoningContent: RESPONSE_TEXT[step],
			modelInfo: { identifier: input?.responseModel ?? MODEL },
			stats: {
				stopReason: "eosFound",
				...(input?.omitUsage
					? {}
					: {
						promptTokensCount: promptTokens,
						predictedTokensCount: completionTokens,
						totalTokensCount: promptTokens + completionTokens,
					}),
			},
		});
	});
	nativeSdk.listLoaded.mockResolvedValue([{
		identifier: MODEL,
		modelKey: MODEL,
		path: MODEL,
		displayName: MODEL,
		respond: nativeSdk.respond,
	}]);
	return { requests };
}

afterEach(() => {
	vi.clearAllMocks();
	nativeSdk.dispose.mockResolvedValue(undefined);
});

test("benchmarks the exact dependent two-step roster at every canonical message load", async () => {
	const { runtime, close } = createRuntime();
	const { requests } = installNativeCompletions();
	const resultsDirectory = await mkdtemp(join(tmpdir(), "bc-news-context-benchmark-"));
	const times = [new Date("2026-08-06T12:00:00.000Z"), new Date("2026-08-06T12:01:00.000Z")];
	const { path, report } = await runContextBenchmark({
		fixturePath: REPRESENTATIVE_FIXTURE_PATH,
		resultsDirectory,
		environment: benchmarkEnvironment(),
		runtime,
		now: () => times.shift() ?? new Date("2026-08-06T12:01:00.000Z"),
	});

	const expectedSteps: ProductionStep[] = CONTEXT_BENCHMARK_LOADS.flatMap(() => [
		"main_story_write",
		"announcements_write",
	]);
	expect(requests.map(({ step }) => step)).toEqual(expectedSteps);
	expect(report.rows.map((row) => row.message_load)).toEqual(
		CONTEXT_BENCHMARK_LOADS.flatMap((load) => [load, load]),
	);
	expect(nativeSdk.respond).toHaveBeenCalledTimes(10);
	expect(nativeSdk.dispose).toHaveBeenCalledTimes(10);
	expect(close).toHaveBeenCalledOnce();

	const temperatures = {
		main_story_write: 0.7,
		announcements_write: 0.6,
	};
	for (const [index, request] of requests.entries()) {
		expect(request.step).toBe(expectedSteps[index]);
		expect(request.options).toMatchObject({
			temperature: temperatures[request.step],
			topPSampling: 0.95,
			topKSampling: 20,
			enableThinking: false,
		});
		expect(request.options.structured.type).toBe("json");
		expect(request.options.structured.jsonSchema).toEqual(expect.objectContaining({ type: "object" }));
	}

	expect(report.version).toBe(3);
	expect(report.loads).toEqual(CONTEXT_BENCHMARK_LOADS);
	expect(report.model).toEqual({
		identifier: MODEL_METADATA.identifier,
		model_key: MODEL_METADATA.modelKey,
		path: MODEL_METADATA.path,
		display_name: MODEL_METADATA.displayName,
		context_length: MODEL_METADATA.contextLength,
		measurement_runtime: "lmstudio_sdk_1.5",
	});
	for (const row of report.rows) {
		expect(row.fixed_input_tokens + row.evidence_or_draft_tokens + row.runtime_delta_tokens)
			.toBe(row.input_tokens);
		expect(row.input_tokens + row.completion_tokens).toBe(row.total_tokens);
		expect(row.total_tokens + row.context_headroom_tokens).toBe(MODEL_METADATA.contextLength);
		expect(row.runtime_delta_tokens).toBe(7);
	}
	expect(report.agent_configurations).toEqual({
		main_story_write: localStepConfig(MODEL, 0.7),
		announcements_write: localStepConfig(MODEL, 0.6),
	});

	const saved = await readFile(path, "utf8");
	expect(saved).toBe(`${JSON.stringify(report, null, 2)}\n`);
	expect(JSON.parse(saved)).toEqual(report);
});

test("omits inference settings independently for provider-default candidates", async () => {
	const { runtime } = createRuntime();
	const { requests } = installNativeCompletions();
	const { report } = await runContextBenchmark({
		fixturePath: REPRESENTATIVE_FIXTURE_PATH,
		resultsDirectory: await mkdtemp(join(tmpdir(), "bc-news-context-defaults-")),
		environment: benchmarkEnvironment(PROVIDER_DEFAULT_MODEL_CONFIG),
		runtime,
	});

	for (const request of requests) {
		expect(request.options).not.toHaveProperty("temperature");
		expect(request.options).not.toHaveProperty("topPSampling");
		expect(request.options).not.toHaveProperty("topKSampling");
		expect(request.options).not.toHaveProperty("enableThinking");
	}
	expect(report.agent_configurations).toEqual({
		main_story_write: providerDefaultLocalStepConfig(MODEL),
		announcements_write: providerDefaultLocalStepConfig(MODEL),
	});
});

test("rejects recorded and hosted adapters before opening the local runtime", async () => {
	for (const replacement of [
		{ adapter: "recorded" },
		{
			adapter: "openai_compatible_hosted",
			provider: "remote",
			model: MODEL,
			billing: {
				method: "calculated",
				input_usd_per_million_tokens: 1,
				output_usd_per_million_tokens: 1,
				pricing_reference: "test",
			},
		},
	]) {
		const { runtime, getOnlyLoadedQwen } = createRuntime();
		const config = JSON.parse(MODEL_CONFIG) as Record<string, unknown>;
		config.main_story_write = replacement;
		await expect(runContextBenchmark({
			fixturePath: REPRESENTATIVE_FIXTURE_PATH,
			resultsDirectory: await mkdtemp(join(tmpdir(), "bc-news-context-rejection-")),
			environment: benchmarkEnvironment(JSON.stringify(config)),
			runtime,
		})).rejects.toMatchObject({ code: "non_lmstudio_config" });
		expect(getOnlyLoadedQwen).not.toHaveBeenCalled();
	}
});

test("rejects mixed local model names before opening the local runtime", async () => {
	const { runtime, getOnlyLoadedQwen } = createRuntime();
	const config = JSON.parse(MODEL_CONFIG) as Record<string, unknown>;
	config.announcements_write = localStepConfig("another-qwen", 0.3);

	await expect(runContextBenchmark({
		fixturePath: REPRESENTATIVE_FIXTURE_PATH,
		resultsDirectory: await mkdtemp(join(tmpdir(), "bc-news-context-mixed-")),
		environment: benchmarkEnvironment(JSON.stringify(config)),
		runtime,
	})).rejects.toMatchObject({ code: "mixed_model_config" });
	expect(getOnlyLoadedQwen).not.toHaveBeenCalled();
});

test("accepts independent explicit and provider-default inference settings", async () => {
	const { runtime, getOnlyLoadedQwen } = createRuntime();
	installNativeCompletions();
	const config = JSON.parse(MODEL_CONFIG) as Record<string, unknown>;
	config.announcements_write = providerDefaultLocalStepConfig(MODEL);

	const { report } = await runContextBenchmark({
		fixturePath: REPRESENTATIVE_FIXTURE_PATH,
		resultsDirectory: await mkdtemp(join(tmpdir(), "bc-news-context-mixed-posture-")),
		environment: benchmarkEnvironment(JSON.stringify(config)),
		runtime,
	});
	expect(report.agent_configurations.main_story_write).toMatchObject({
		temperature: 0.7,
		top_p: 0.95,
		top_k: 20,
		enable_thinking: false,
	});
	expect(report.agent_configurations.announcements_write).not.toHaveProperty("temperature");
	expect(getOnlyLoadedQwen).toHaveBeenCalledOnce();
});

test("rejects unavailable provider usage and closes the runtime", async () => {
	const { runtime, close } = createRuntime();
	installNativeCompletions({ omitUsage: true });

	await expect(runContextBenchmark({
		fixturePath: REPRESENTATIVE_FIXTURE_PATH,
		resultsDirectory: await mkdtemp(join(tmpdir(), "bc-news-context-usage-")),
		environment: benchmarkEnvironment(),
		runtime,
	})).rejects.toMatchObject({ code: "token_usage_unavailable" });
	expect(close).toHaveBeenCalledOnce();
});

test("rejects a completion from a model other than the loaded Qwen and closes the runtime", async () => {
	const { runtime, close } = createRuntime();
	installNativeCompletions({ responseModel: "different-model" });

	await expect(runContextBenchmark({
		fixturePath: REPRESENTATIVE_FIXTURE_PATH,
		resultsDirectory: await mkdtemp(join(tmpdir(), "bc-news-context-model-")),
		environment: benchmarkEnvironment(),
		runtime,
	})).rejects.toMatchObject({ code: "model_response_mismatch" });
	expect(close).toHaveBeenCalledOnce();
});

test("parses the context command without admitting run-only configuration", () => {
	expect(parseEvalCliCommand([
		"context",
		"benchmark",
		"--fixture",
		"packages/fixtures",
		"--results-dir",
		"tmp/context",
	])).toEqual({
		command: "context-benchmark",
		fixturePath: "packages/fixtures",
		resultsDirectory: "tmp/context",
	});
	expect(() => parseEvalCliCommand([
		"context",
		"benchmark",
		"--fixture",
		"packages/fixtures",
		"--config",
		"hosted.json",
	])).toThrow("--config is not valid for the context benchmark command");
});
