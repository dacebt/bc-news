import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RecordedModelResponseSchema } from "@bc-news/fixtures";
import { afterEach, expect } from "vitest";
import {
	V7BenchmarkRunSchema,
	type BenchmarkRun,
	type V7BenchmarkRun,
} from "../src/evaluation-artifact";
import { EvaluationArtifactStore } from "../src/evaluation-artifact-store";
import { RECORDED_OUTPUT_FIXTURE_PATH } from "../src/representative-fixture";
import { evaluateTrialCommand } from "../src/evaluation-trial-command";
import {
	CURRENT_PRODUCTION_MODEL_STEPS,
	type CurrentProductionModelStep,
} from "../src/current-production-steps";
import { startRecordLoopbackServer } from "../src/record-loopback-server";

const RESPONSE_DIRECTORY = new URL("../../../packages/fixtures/model-responses/", import.meta.url).pathname;
export const TEST_SOURCE_PROVENANCE = {
	repository: "bc-news" as const,
	commit_sha: "1111111111111111111111111111111111111111",
	dirty: false as const,
};
const HISTORICAL_V7_ARTIFACT_PATH = new URL(
	"../evaluation-results/benchmark-2026-08-11T05-11-11-620Z-f33e5348-fcd6-4efc-8c3a-46be18d9a66f.json",
	import.meta.url,
);

const temporaryRoots = new Set<string>();

export async function temporaryRoot(prefix: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), prefix));
	temporaryRoots.add(root);
	return root;
}

afterEach(async () => {
	await Promise.all([...temporaryRoots].map(async (root) => rm(root, { recursive: true, force: true })));
	temporaryRoots.clear();
});

export async function controlledEvaluation(
	observer?: (artifact: BenchmarkRun, resultsDirectory: string) => void | Promise<void>,
	repetitions = 1,
	outputOverrides: Partial<Record<CurrentProductionModelStep, string>> = {},
) {
	const root = await temporaryRoot("bc-news-evaluation-test-");
	const resultsDirectory = join(root, "results");
	const configPath = join(root, "config.json");
	const config = { production_steps: Object.fromEntries(CURRENT_PRODUCTION_MODEL_STEPS.map((step) => [step, {
		adapter: "openai_compatible_hosted", provider: "repository_loopback", model: `test/${step}`,
		billing: { method: "calculated", input_usd_per_million_tokens: 0, output_usd_per_million_tokens: 0, pricing_reference: "repository test" },
	}])) };
	await writeFile(configPath, `${JSON.stringify(config)}\n`, "utf8");
	const outputs = Object.fromEntries(await Promise.all(CURRENT_PRODUCTION_MODEL_STEPS.map(async (step) => {
		const response = RecordedModelResponseSchema.parse(JSON.parse(await readFile(join(RESPONSE_DIRECTORY, `${step}.json`), "utf8")) as unknown);
		return [`test/${step}`, outputOverrides[step] ?? response.text];
	}))) as Record<CurrentProductionModelStep, string>;
	const server = await startRecordLoopbackServer(outputs);
	try {
		const results = [];
		for (let index = 0; index < repetitions; index += 1) {
			results.push(await evaluateTrialCommand({
				fixturePath: RECORDED_OUTPUT_FIXTURE_PATH, configPath, resultsDirectory,
				environment: { HOSTED_MODEL_BASE_URL: server.baseUrl, HOSTED_MODEL_API_KEY: "record-loopback-proof" },
				sourceProvenance: TEST_SOURCE_PROVENANCE,
				...(observer === undefined ? {} : { artifactObserver: (artifact: BenchmarkRun) => observer(artifact, resultsDirectory) }),
			}));
		}
		return { result: results.at(-1)!, results, resultsDirectory };
	} finally { await server.close(); }
}

async function recordedOutput(step: CurrentProductionModelStep): Promise<string> {
	const response = RecordedModelResponseSchema.parse(JSON.parse(await readFile(join(RESPONSE_DIRECTORY, `${step}.json`), "utf8")) as unknown);
	return response.text;
}

export async function writerOutputWithNumericLiteral(
	step: CurrentProductionModelStep,
): Promise<string> {
	const output = JSON.parse(await recordedOutput(step)) as Record<string, unknown>;
	if (step === "main_story_write") {
		const mainStory = output.main_story as Record<string, unknown>;
		mainStory.body = `${String(mainStory.body)} 999`;
	} else {
		const announcements = output.announcements as Array<Record<string, unknown>>;
		announcements[0]!.summary = `${String(announcements[0]!.summary)} 999`;
	}
	return JSON.stringify(output);
}

export async function finalProductRejectedWriterOutput(
	step: CurrentProductionModelStep,
): Promise<string> {
	const output = JSON.parse(await recordedOutput(step)) as Record<string, unknown>;
	if (step === "main_story_write") {
		const mainStory = output.main_story as Record<string, unknown>;
		mainStory.body = `${String(mainStory.body)} system prompt`;
	} else {
		const announcements = output.announcements as Array<Record<string, unknown>>;
		announcements[0]!.title = "system prompt";
	}
	return JSON.stringify(output);
}

export function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
export function sha256Json(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export async function historicalV7BenchmarkRun(): Promise<V7BenchmarkRun> {
	return V7BenchmarkRunSchema.parse(
		JSON.parse(await readFile(HISTORICAL_V7_ARTIFACT_PATH, "utf8")) as unknown,
	);
}

export async function rejectsWithoutChangingBytes(store: EvaluationArtifactStore, path: string, mutation: BenchmarkRun): Promise<void> {
	const originalBytes = await readFile(path);
	await expect(store.replace(mutation)).rejects.toMatchObject({ code: "write_rejected" });
	expect(await readFile(path)).toEqual(originalBytes);
}
