import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	RecordedModelResponseSchema,
	fixtureEvidenceInput,
	type RecordedModelResponse,
} from "@bc-news/fixtures";
import {
	SYSTEM_CONSTRAINTS,
	buildAnnouncementsPrompt,
	buildMainStoryPrompt,
	buildPackagingPrompt,
	parseAnnouncementsOutput,
	parseMainStoryOutput,
	parsePackagingOutput,
	prepareEvidence,
	type EditorialCapability,
	type ModelProviderPort,
} from "@bc-news/generation-core";
import { OpenAiCompatibleRetryableError } from "@bc-news/model-adapters";
import { resolveModelProvider, type ModelAdapterConfig } from "../src/adapters/model-adapters";
import { ModelConfigSchema } from "../src/config";
import { GenerationConfigError } from "../src/config-error";
import {
	createModelResponseStagingDirectory,
	promoteModelResponseDirectory,
	recoverModelResponseDirectory,
	removeStagingDirectory,
} from "./model-response-directory";

const FIXTURE_ACTIVE_REGION_ID = "7";
const FIXTURE_EVIDENCE_DATE = "2026-01-24";
const FIXTURE_PUBLICATION_DATE = "2026-01-25";
const CAPABILITIES = ["announcements", "main_story", "packaging"] as const;

interface ReRecordEnvironment {
	LMSTUDIO_BASE_URL?: string;
	HOSTED_MODEL_BASE_URL?: string;
	HOSTED_MODEL_API_KEY?: string;
	MODEL_CONFIG: string;
}

interface CompletionInput {
	editorialCapability: EditorialCapability;
	provider: ModelProviderPort;
	user: string;
}

export function promptSha256(system: string, user: string): string {
	return createHash("sha256").update(JSON.stringify({ system, user }), "utf8").digest("hex");
}

function parseModelConfig(raw: string): Record<EditorialCapability, ModelAdapterConfig> {
	let candidate: unknown;
	try {
		candidate = JSON.parse(raw);
	} catch (cause) {
		throw new GenerationConfigError("MODEL_CONFIG is not valid JSON", { cause });
	}
	const result = ModelConfigSchema.safeParse(candidate);
	if (!result.success) {
		throw new GenerationConfigError(`MODEL_CONFIG rejected: ${result.error.message}`);
	}
	for (const capability of CAPABILITIES) {
		if (result.data[capability].adapter === "recorded") {
			throw new GenerationConfigError(
				`Re-recording requires a live adapter for ${capability}; received recorded`,
			);
		}
	}
	return result.data;
}

async function completeWithThreeAttempts(input: CompletionInput): Promise<RecordedModelResponse> {
	let lastFailure: OpenAiCompatibleRetryableError | undefined;
	for (let attempt = 1; attempt <= 3; attempt += 1) {
		try {
			const completion = await input.provider.complete({
				editorialCapability: input.editorialCapability,
				system: SYSTEM_CONSTRAINTS,
				user: input.user,
			});
			return RecordedModelResponseSchema.parse({
				editorial_capability: input.editorialCapability,
				provider: completion.provider,
				model: completion.model,
				prompt_sha256: promptSha256(SYSTEM_CONSTRAINTS, input.user),
				text: completion.text,
			});
		} catch (error) {
			if (!(error instanceof OpenAiCompatibleRetryableError)) throw error;
			lastFailure = error;
			if (attempt === 3) throw error;
		}
	}
	throw lastFailure ?? new Error("Model completion attempt loop exited without a result");
}

async function validateModelResponseDirectory(directory: string): Promise<void> {
	const fileNames = (await readdir(directory)).sort();
	const expectedFileNames = CAPABILITIES.map((capability) => `${capability}.json`).sort();
	if (fileNames.join(",") !== expectedFileNames.join(",")) {
		throw new Error(`Model-response directory has unexpected files: ${fileNames.join(", ")}`);
	}
	for (const capability of CAPABILITIES) {
		const raw = await readFile(path.join(directory, `${capability}.json`), "utf8");
		const parsed = RecordedModelResponseSchema.parse(JSON.parse(raw) as unknown);
		if (parsed.editorial_capability !== capability) {
			throw new Error(
				`Staged ${capability}.json declares editorial capability ${parsed.editorial_capability}`,
			);
		}
	}
}

export async function recordModelResponses(
	outputDirectory: string,
	environment: ReRecordEnvironment,
): Promise<void> {
	const modelConfig = parseModelConfig(environment.MODEL_CONFIG);
	const providerEnvironment = {
		...(environment.LMSTUDIO_BASE_URL === undefined ? {} : { LMSTUDIO_BASE_URL: environment.LMSTUDIO_BASE_URL }),
		...(environment.HOSTED_MODEL_BASE_URL === undefined ? {} : { HOSTED_MODEL_BASE_URL: environment.HOSTED_MODEL_BASE_URL }),
		...(environment.HOSTED_MODEL_API_KEY === undefined ? {} : { HOSTED_MODEL_API_KEY: environment.HOSTED_MODEL_API_KEY }),
	};
	const providers = {
		announcements: resolveModelProvider(
			"announcements",
			modelConfig.announcements,
			providerEnvironment,
		),
		main_story: resolveModelProvider("main_story", modelConfig.main_story, providerEnvironment),
		packaging: resolveModelProvider("packaging", modelConfig.packaging, providerEnvironment),
	};

	await recoverModelResponseDirectory(outputDirectory, validateModelResponseDirectory);
	const stagingDirectory = await createModelResponseStagingDirectory(outputDirectory);
	try {
		const messages = await fixtureEvidenceInput.loadEvidence({
			activeRegionId: FIXTURE_ACTIVE_REGION_ID,
			evidenceDate: FIXTURE_EVIDENCE_DATE,
		});
		const preparedEvidence = prepareEvidence({
			activeRegionId: FIXTURE_ACTIVE_REGION_ID,
			publicationDate: FIXTURE_PUBLICATION_DATE,
			messages,
		});
		const announcementsPrompt = buildAnnouncementsPrompt(preparedEvidence);
		const mainStoryPrompt = buildMainStoryPrompt(preparedEvidence);
		const [announcementsRecord, mainStoryRecord] = await Promise.all([
			completeWithThreeAttempts({
				editorialCapability: "announcements",
				provider: providers.announcements,
				user: announcementsPrompt,
			}),
			completeWithThreeAttempts({
				editorialCapability: "main_story",
				provider: providers.main_story,
				user: mainStoryPrompt,
			}),
		]);
		const announcements = parseAnnouncementsOutput(announcementsRecord.text);
		const mainStory = parseMainStoryOutput(mainStoryRecord.text);
		const packagingPrompt = buildPackagingPrompt(mainStory, announcements, {
			activeRegionId: FIXTURE_ACTIVE_REGION_ID,
			publicationDate: FIXTURE_PUBLICATION_DATE,
		});
		const packagingRecord = await completeWithThreeAttempts({
			editorialCapability: "packaging",
			provider: providers.packaging,
			user: packagingPrompt,
		});
		parsePackagingOutput(packagingRecord.text);

		const records = { announcements: announcementsRecord, main_story: mainStoryRecord, packaging: packagingRecord };
		for (const capability of CAPABILITIES) {
			await writeFile(
				path.join(stagingDirectory, `${capability}.json`),
				`${JSON.stringify(records[capability], null, 2)}\n`,
				"utf8",
			);
		}
		await validateModelResponseDirectory(stagingDirectory);
		await promoteModelResponseDirectory(stagingDirectory, outputDirectory);
	} finally {
		await removeStagingDirectory(stagingDirectory);
	}
}

function outputDirectoryFromArgs(args: string[]): string {
	const flagIndex = args.indexOf("--output-dir");
	if (flagIndex === -1) {
		return fileURLToPath(new URL("../../../packages/fixtures/model-responses", import.meta.url));
	}
	const value = args[flagIndex + 1];
	if (value === undefined || value === "") {
		throw new Error("--output-dir requires a directory path");
	}
	return path.resolve(value);
}

async function main(): Promise<void> {
	const modelConfig = process.env.MODEL_CONFIG;
	if (modelConfig === undefined || modelConfig === "") {
		throw new GenerationConfigError("MODEL_CONFIG is required for re-recording");
	}
	const outputDirectory = outputDirectoryFromArgs(process.argv.slice(2));
	await recordModelResponses(outputDirectory, {
		MODEL_CONFIG: modelConfig,
		...(process.env.LMSTUDIO_BASE_URL === undefined ? {} : { LMSTUDIO_BASE_URL: process.env.LMSTUDIO_BASE_URL }),
		...(process.env.HOSTED_MODEL_BASE_URL === undefined ? {} : { HOSTED_MODEL_BASE_URL: process.env.HOSTED_MODEL_BASE_URL }),
		...(process.env.HOSTED_MODEL_API_KEY === undefined ? {} : { HOSTED_MODEL_API_KEY: process.env.HOSTED_MODEL_API_KEY }),
	});
	console.log(`Recorded announcements, main_story, and packaging responses in ${outputDirectory}`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main();
}
