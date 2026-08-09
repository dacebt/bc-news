import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	RecordedModelResponseV2Schema,
	modelRequestSha256,
	type RecordedModelResponseRoster,
} from "@bc-news/fixtures";
import {
	PRODUCTION_MODEL_STEPS,
	type ModelProviderRequest,
	type ProductionModelStep,
} from "@bc-news/generation-core";
import { afterEach, expect, test, vi } from "vitest";
import { recordCommand } from "../src/record-command";
import { validateRecordedResponseDirectory } from "../src/recorded-response-directory";
import { formatRecordSummary } from "../src/report";

interface ProviderState {
	requests: ModelProviderRequest[];
	rejectedStep: ProductionModelStep | undefined;
	rejectResolution: boolean;
}

const providerState = vi.hoisted<ProviderState>(() => ({
	requests: [],
	rejectedStep: undefined,
	rejectResolution: false,
}));

vi.mock("../src/model-adapters", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/model-adapters")>();
	const responseText: Readonly<Record<ProductionModelStep, string>> = {
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
				body: "**Aryn** invited the region to a dungeon crawl — together.\n\n**Archaelic** joined the group.",
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
	};
	return {
		...actual,
		resolveModelProvider: () => {
			if (providerState.rejectResolution) throw new Error("provider resolution rejected");
			return {
				complete(request: ModelProviderRequest) {
					providerState.requests.push(request);
					return Promise.resolve({
						text: providerState.rejectedStep === request.productionStep
							? "not structured output"
							: responseText[request.productionStep],
						provider: `memory-${request.productionStep}`,
						model: "memory-model",
						execution: "local_inference" as const,
						token_usage: { measurement: "unavailable" as const },
						external_billing: {
							classification: "none" as const,
							amount_usd: 0 as const,
							reason: "local_inference" as const,
						},
					});
				},
			};
		},
	};
});

const FIXTURE_PATH = new URL("../../../packages/fixtures", import.meta.url).pathname;

const EXPLICIT_SAMPLING = { temperature: 0, top_p: 1, top_k: 40 } as const;

function localAdapterConfig(sampling?: {
	readonly temperature: number;
	readonly top_p: number;
	readonly top_k: number;
}) {
	const config = {
		adapter: "lmstudio",
		model: "memory-model",
		reasoning_effort: "provider_default",
	} as const;
	return sampling === undefined ? config : { ...config, sampling };
}

function hostedAdapterConfig() {
	return {
		adapter: "openai_compatible_hosted",
		provider: "memory-hosted",
		model: "memory-model",
		billing: {
			method: "calculated",
			input_usd_per_million_tokens: 0,
			output_usd_per_million_tokens: 0,
			pricing_reference: "memory test",
		},
	} as const;
}

function explicitProductionSteps() {
	return {
		main_story_write: localAdapterConfig(EXPLICIT_SAMPLING),
		main_story_copyedit: localAdapterConfig(EXPLICIT_SAMPLING),
		announcements_write: localAdapterConfig(EXPLICIT_SAMPLING),
		announcements_copyedit: localAdapterConfig(EXPLICIT_SAMPLING),
	};
}

type TestModelConfig = ReturnType<typeof localAdapterConfig> | ReturnType<typeof hostedAdapterConfig>;
type TestProductionSteps = Readonly<Record<ProductionModelStep, TestModelConfig>>;

async function writeConfig(
	root: string,
	productionSteps: TestProductionSteps = explicitProductionSteps(),
): Promise<string> {
	const path = join(root, "recorder-config.json");
	await writeFile(path, JSON.stringify({
		production_steps: productionSteps,
	}));
	return path;
}

function priorRoster(): RecordedModelResponseRoster {
	const response = (productionStep: ProductionModelStep) => ({
		production_step: productionStep,
		provider: "prior-provider",
		model: "prior-model",
		prompt_sha256: "a".repeat(64),
		text: `prior-${productionStep}`,
	});
	return {
		main_story_write: response("main_story_write"),
		main_story_copyedit: response("main_story_copyedit"),
		announcements_write: response("announcements_write"),
		announcements_copyedit: response("announcements_copyedit"),
	};
}

async function writePriorRoster(directory: string): Promise<void> {
	await mkdir(directory);
	const responses = priorRoster();
	await Promise.all(PRODUCTION_MODEL_STEPS.map((step) =>
		writeFile(join(directory, `${step}.json`), `${JSON.stringify(responses[step])}\n`),
	));
}

async function directoryBytes(directory: string): Promise<Readonly<Record<ProductionModelStep, string>>> {
	const [mainStoryWrite, mainStoryCopyedit, announcementsWrite, announcementsCopyedit] = await Promise.all([
		readFile(join(directory, "main_story_write.json"), "utf8"),
		readFile(join(directory, "main_story_copyedit.json"), "utf8"),
		readFile(join(directory, "announcements_write.json"), "utf8"),
		readFile(join(directory, "announcements_copyedit.json"), "utf8"),
	]);
	return {
		main_story_write: mainStoryWrite,
		main_story_copyedit: mainStoryCopyedit,
		announcements_write: announcementsWrite,
		announcements_copyedit: announcementsCopyedit,
	};
}

afterEach(() => {
	providerState.requests.length = 0;
	providerState.rejectedStep = undefined;
	providerState.rejectResolution = false;
});

test("rejects an unavailable provider roster before creating recorder state", async () => {
	const root = await mkdtemp(join(tmpdir(), "bc-news-record-resolution-"));
	const responseDirectory = join(root, "responses");
	providerState.rejectResolution = true;

	await expect(recordCommand({
		fixturePath: FIXTURE_PATH,
		configPath: await writeConfig(root),
		responseDirectory,
		environment: {},
	})).rejects.toThrow("provider resolution rejected");
	expect(await readdir(root)).toEqual(["recorder-config.json"]);
});

test("rejects an unavailable fixture without mutating recorder state", async () => {
	const root = await mkdtemp(join(tmpdir(), "bc-news-record-fixture-"));
	const responseDirectory = join(root, "responses");
	const abandonedStaging = join(
		root,
		"responses.recording-staging-00000000-0000-4000-8000-000000000000",
	);
	await writePriorRoster(responseDirectory);
	await mkdir(abandonedStaging);
	await writeFile(join(abandonedStaging, "partial.json"), "abandoned staging bytes");
	const configPath = await writeConfig(root);
	const entriesBefore = await readdir(root);
	const responseBytesBefore = await directoryBytes(responseDirectory);
	const stagingBytesBefore = await readFile(join(abandonedStaging, "partial.json"), "utf8");

	await expect(recordCommand({
		fixturePath: join(root, "missing-fixture"),
		configPath,
		responseDirectory,
		environment: {},
	})).rejects.toThrow();
	expect(await readdir(root)).toEqual(entriesBefore);
	expect(await directoryBytes(responseDirectory)).toEqual(responseBytesBefore);
	expect(await readFile(join(abandonedStaging, "partial.json"), "utf8"))
		.toBe(stagingBytesBefore);
});

test("binds every retained response to the exact dependent live request", async () => {
	const root = await mkdtemp(join(tmpdir(), "bc-news-record-command-"));
	const responseDirectory = join(root, "responses");
	const result = await recordCommand({
		fixturePath: FIXTURE_PATH,
		configPath: await writeConfig(root),
		responseDirectory,
		environment: {},
	});

	expect(providerState.requests.map((request) => request.productionStep)).toEqual(PRODUCTION_MODEL_STEPS);
	const retained = await validateRecordedResponseDirectory(responseDirectory);
	for (const request of providerState.requests) {
		const response = RecordedModelResponseV2Schema.parse(retained[request.productionStep]);
		expect(response.prompt_sha256).toBe(await modelRequestSha256(request));
		expect(response.provider).toBe(`memory-${request.productionStep}`);
		expect(response.model).toBe("memory-model");
		expect(response.sampling).toEqual({
			adapter: "lmstudio",
			posture: "explicit",
			config: EXPLICIT_SAMPLING,
		});
	}
	expect(result.responseDirectory).toBe(responseDirectory);
	expect(result.comparison.differences).toEqual([]);
	expect(result.replayProducts).toEqual(result.liveProducts);
	expect(result.liveDiagnostics).toEqual(result.replayDiagnostics);
	expect(result.liveDiagnostics).toEqual(expect.arrayContaining([
		expect.objectContaining({
			kind: "final_product",
			production_step: "main_story_copyedit",
			code: "forbidden_marker",
		}),
	]));
	expect(formatRecordSummary(result)).toContain("Artifact version: 2");
	expect(formatRecordSummary(result)).toContain("lmstudio/explicit(temperature=0, top_p=1, top_k=40)");
	expect(formatRecordSummary(result)).toContain("Live diagnostics:");
	expect(formatRecordSummary(result)).toContain("Replay diagnostics:");
});

test("retains provider-default and hosted sampling truth per production step", async () => {
	const root = await mkdtemp(join(tmpdir(), "bc-news-record-sampling-"));
	const responseDirectory = join(root, "responses");
	const configPath = await writeConfig(root, {
		main_story_write: localAdapterConfig(),
		main_story_copyedit: localAdapterConfig(),
		announcements_write: hostedAdapterConfig(),
		announcements_copyedit: localAdapterConfig(),
	});

	const result = await recordCommand({
		fixturePath: FIXTURE_PATH,
		configPath,
		responseDirectory,
		environment: {},
	});
	const retained = await validateRecordedResponseDirectory(responseDirectory);
	const mainStoryWrite = RecordedModelResponseV2Schema.parse(retained.main_story_write);
	const mainStoryCopyedit = RecordedModelResponseV2Schema.parse(retained.main_story_copyedit);
	const announcementsWrite = RecordedModelResponseV2Schema.parse(retained.announcements_write);
	const announcementsCopyedit = RecordedModelResponseV2Schema.parse(retained.announcements_copyedit);

	expect(mainStoryWrite.sampling).toEqual({ adapter: "lmstudio", posture: "provider_default" });
	expect(mainStoryCopyedit.sampling).toEqual({ adapter: "lmstudio", posture: "provider_default" });
	expect(announcementsWrite.sampling).toEqual({
		adapter: "openai_compatible_hosted",
		posture: "not_applicable",
	});
	expect(announcementsCopyedit.sampling).toEqual({ adapter: "lmstudio", posture: "provider_default" });
	expect(formatRecordSummary(result)).toContain("main_story_write: lmstudio/provider_default");
	expect(formatRecordSummary(result)).toContain("announcements_write: openai_compatible_hosted/not_applicable");
});

test("leaves the prior response set unchanged when live output is rejected", async () => {
	const root = await mkdtemp(join(tmpdir(), "bc-news-record-rejection-"));
	const responseDirectory = join(root, "responses");
	await writePriorRoster(responseDirectory);
	const before = await directoryBytes(responseDirectory);
	providerState.rejectedStep = "main_story_copyedit";

	await expect(recordCommand({
		fixturePath: FIXTURE_PATH,
		configPath: await writeConfig(root),
		responseDirectory,
		environment: {},
	})).rejects.toThrow();
	expect(await directoryBytes(responseDirectory)).toEqual(before);
});
