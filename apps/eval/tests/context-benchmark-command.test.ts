import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import {
	attachAnnouncementIds,
	buildAnnouncementsCopyeditPrompt,
	buildMainStoryCopyeditPrompt,
	parseAnnouncementsWriterOutput,
	parseMainStoryWriterOutput,
} from "@bc-news/generation-core";
import { REPRESENTATIVE_FIXTURE_PATH } from "../src/representative-fixture";
import { parseEvalCliCommand } from "../src/cli-options";
import { runContextBenchmark } from "../src/context-benchmark-command";
import { CONTEXT_BENCHMARK_LOADS } from "../src/context-benchmark-file";
import type {
	ContextBenchmarkModel,
	ContextBenchmarkPrompt,
	ContextBenchmarkRuntime,
} from "../src/context-benchmark-runtime";

const MODEL = "qwen3-local";
const MODEL_METADATA = {
	identifier: MODEL,
	modelKey: "qwen3-local-key",
	path: "lmstudio-community/qwen3-local",
	displayName: "Qwen 3 Local",
	contextLength: 1_000_000,
} as const;

const MODEL_CONFIG = JSON.stringify({
	main_story_write: localStepConfig(MODEL),
	main_story_copyedit: localStepConfig(MODEL),
	announcements_write: localStepConfig(MODEL),
	announcements_copyedit: localStepConfig(MODEL),
});

const RESPONSE_TEXT = {
	main_story_write: JSON.stringify({
		title: "Regional Chronicle",
		subtitle: "January 25, 2026",
		main_story: {
			headline: "Aryn Organizes a Dungeon Muster",
			lede: "Aryn organized a regional dungeon muster.",
			body: "**Aryn** invited the region to a dungeon crawl.\n\n**Archaelic** joined the group.",
		},
	}),
	main_story_copyedit: JSON.stringify({
		title: "Regional Chronicle",
		subtitle: "January 25, 2026",
		main_story: {
			headline: "Aryn Organizes a Dungeon Muster",
			lede: "Aryn organized a regional dungeon muster.",
			body: "**Aryn** invited the region to a dungeon crawl.\n\n**Archaelic** joined the group.",
		},
	}),
	announcements_write: JSON.stringify({
		announcements: [{ title: "Sailing Milestone", summary: "**KeyserSoze** reached level 75." }],
	}),
	announcements_copyedit: JSON.stringify({
		announcements: [{
			id: "announcement-1",
			title: "Sailing Milestone",
			summary: "**KeyserSoze** reached level 75.",
		}],
	}),
} as const;

type ProductionStep = keyof typeof RESPONSE_TEXT;
type RequestBody = {
	readonly model: string;
	readonly messages: readonly [
		{ readonly role: "system"; readonly content: string },
		{ readonly role: "user"; readonly content: string },
	];
	readonly response_format: {
		readonly type: string;
		readonly json_schema: {
			readonly name: string;
			readonly strict: boolean;
			readonly schema: Readonly<Record<string, unknown>>;
		};
	};
};

function localStepConfig(model: string) {
	return {
		adapter: "lmstudio",
		model,
		sampling: { temperature: 0, top_p: 1, top_k: 40 },
		reasoning_effort: "none",
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

function productionStep(body: RequestBody): ProductionStep {
	return body.response_format.json_schema.name.replace(/_output$/u, "") as ProductionStep;
}

function installCompletionFetch(input?: {
	readonly omitUsage?: boolean;
	readonly responseModel?: string;
}) {
	const requests: RequestBody[] = [];
	const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
		if (typeof init?.body !== "string") throw new Error("Expected a string request body");
		const body = JSON.parse(init.body) as RequestBody;
		requests.push(body);
		const promptTokens = JSON.stringify(body.messages).length + 7;
		const completionTokens = 11;
		return Promise.resolve(new Response(JSON.stringify({
			model: input?.responseModel ?? MODEL,
			choices: [{ message: { content: RESPONSE_TEXT[productionStep(body)] } }],
			...(input?.omitUsage
				? {}
				: {
					usage: {
						prompt_tokens: promptTokens,
						completion_tokens: completionTokens,
						total_tokens: promptTokens + completionTokens,
					},
				}),
		}), { status: 200, headers: { "Content-Type": "application/json" } }));
	});
	vi.stubGlobal("fetch", fetchMock);
	return { requests, fetchMock };
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

test("benchmarks the exact dependent four-step roster at every canonical message load", async () => {
	const { runtime, close } = createRuntime();
	const { requests, fetchMock } = installCompletionFetch();
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
		"main_story_copyedit",
		"announcements_write",
		"announcements_copyedit",
	]);
	expect(requests.map(productionStep)).toEqual(expectedSteps);
	expect(report.rows.map((row) => row.message_load)).toEqual(
		CONTEXT_BENCHMARK_LOADS.flatMap((load) => [load, load, load, load]),
	);
	expect(fetchMock).toHaveBeenCalledTimes(20);
	expect(close).toHaveBeenCalledOnce();

	const mainStoryDraft = parseMainStoryWriterOutput(RESPONSE_TEXT.main_story_write);
	const announcementsDraft = parseAnnouncementsWriterOutput(RESPONSE_TEXT.announcements_write);
	for (let offset = 0; offset < requests.length; offset += 4) {
		expect(requests[offset + 1]?.messages[1].content).toBe(buildMainStoryCopyeditPrompt(mainStoryDraft));
		expect(requests[offset + 3]?.messages[1].content).toBe(
			buildAnnouncementsCopyeditPrompt(attachAnnouncementIds(announcementsDraft)),
		);
	}

	for (const [index, request] of requests.entries()) {
		expect(request.model).toBe(MODEL);
		expect(request.response_format.type).toBe("json_schema");
		expect(request.response_format.json_schema).toMatchObject({
			name: `${expectedSteps[index]}_output`,
			strict: true,
		});
		expect(request.response_format.json_schema.schema).toEqual(expect.objectContaining({ type: "object" }));
	}

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

	const saved = await readFile(path, "utf8");
	expect(saved).toBe(`${JSON.stringify(report, null, 2)}\n`);
	expect(JSON.parse(saved)).toEqual(report);
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
	config.announcements_copyedit = localStepConfig("another-qwen");

	await expect(runContextBenchmark({
		fixturePath: REPRESENTATIVE_FIXTURE_PATH,
		resultsDirectory: await mkdtemp(join(tmpdir(), "bc-news-context-mixed-")),
		environment: benchmarkEnvironment(JSON.stringify(config)),
		runtime,
	})).rejects.toMatchObject({ code: "mixed_model_config" });
	expect(getOnlyLoadedQwen).not.toHaveBeenCalled();
});

test("rejects unavailable provider usage and closes the runtime", async () => {
	const { runtime, close } = createRuntime();
	installCompletionFetch({ omitUsage: true });

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
	installCompletionFetch({ responseModel: "different-model" });

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
