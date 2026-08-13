import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	createRecordedModelProvider,
	modelRequestSha256,
	type RecordedModelConfiguration,
	type RecordedModelResponseV3,
	type RecordedModelResponseV3Roster,
	type RecordedModelResponseRoster,
} from "@bc-news/fixtures";
import {
	PRODUCTION_MODEL_STEPS,
	prepareEvidence,
	type EditorialDiagnostic,
	type ModelProviderPort,
	type ProductionModelStep,
} from "@bc-news/generation-core";
import { loadConfig } from "./config";
import { loadFixture } from "./evidence-fixture";
import {
	compareFinalEditorialProducts,
	type FinalProductComparison,
} from "./final-product-comparison";
import { resolveModelProvider, type ModelProviderEnvironment } from "./model-adapters";
import { executeProductionSteps, type EvalProducts, type ProductionStepObservation } from "./production-step-runners";
import {
	acquireRecorderLock,
	createRecordedResponseStagingDirectory,
	promoteRecordedResponseDirectory,
	recoverRecordedResponseDirectory,
	removeRecordedResponseStagingDirectory,
	validateRecordedResponseDirectory,
} from "./recorded-response-directory";
import { assertRecorderConfig, type RecorderConfig } from "./recorder-config";

export interface RecordCommandOptions {
	readonly fixturePath: string;
	readonly configPath: string;
	readonly responseDirectory: string;
	readonly environment?: ModelProviderEnvironment;
}

export interface RecordCommandResult {
	readonly responseDirectory: string;
	readonly recordedResponses: RecordedModelResponseV3Roster;
	readonly liveProducts: EvalProducts;
	readonly liveDiagnostics: readonly EditorialDiagnostic[];
	readonly replayProducts: EvalProducts;
	readonly replayDiagnostics: readonly EditorialDiagnostic[];
	readonly comparison: FinalProductComparison;
}

export class RecordCommandError extends Error {
	readonly code: "observation_roster_mismatch" | "completion_text_unavailable" | "final_product_mismatch";
	readonly productionStep: ProductionModelStep | undefined;

	constructor(
		code: RecordCommandError["code"],
		message: string,
		productionStep?: ProductionModelStep,
	) {
		super(message);
		this.name = "RecordCommandError";
		this.code = code;
		this.productionStep = productionStep;
	}
}

type ProviderRoster = Readonly<Record<ProductionModelStep, ModelProviderPort>>;
type LiveModelConfig = RecorderConfig["production_steps"][ProductionModelStep];

function recordedConfiguration(config: LiveModelConfig): RecordedModelConfiguration {
	return structuredClone(config);
}

function resolveRecorderProviders(
	config: RecorderConfig,
	environment: ModelProviderEnvironment,
): ProviderRoster {
	return {
		main_story_write: resolveModelProvider(
			"main_story_write",
			config.production_steps.main_story_write,
			environment,
		),
		main_story_copyedit: resolveModelProvider(
			"main_story_copyedit",
			config.production_steps.main_story_copyedit,
			environment,
		),
		announcements_write: resolveModelProvider(
			"announcements_write",
			config.production_steps.announcements_write,
			environment,
		),
		announcements_copyedit: resolveModelProvider(
			"announcements_copyedit",
			config.production_steps.announcements_copyedit,
			environment,
		),
	};
}

function replayProviderRoster(provider: ModelProviderPort): ProviderRoster {
	return {
		main_story_write: provider,
		main_story_copyedit: provider,
		announcements_write: provider,
		announcements_copyedit: provider,
	};
}

async function recordedResponse(
	expectedStep: ProductionModelStep,
	observation: ProductionStepObservation | undefined,
	config: LiveModelConfig,
): Promise<RecordedModelResponseV3> {
	if (observation === undefined || observation.request.productionStep !== expectedStep) {
		throw new RecordCommandError(
			"observation_roster_mismatch",
			`Expected the live observation for ${expectedStep} in production-step order`,
			expectedStep,
		);
	}
	if (observation.completion.text === null) {
		throw new RecordCommandError(
			"completion_text_unavailable",
			`Cannot record ${expectedStep} because the provider returned no textual completion`,
			expectedStep,
		);
	}
	return {
		version: 3,
		production_step: expectedStep,
		provider: observation.completion.provider,
		model: observation.completion.model,
		prompt_sha256: await modelRequestSha256(observation.request),
		text: observation.completion.text,
		configuration: recordedConfiguration(config),
	};
}

async function recordedResponseRoster(
	config: RecorderConfig,
	observations: readonly ProductionStepObservation[],
): Promise<RecordedModelResponseV3Roster> {
	if (observations.length !== PRODUCTION_MODEL_STEPS.length) {
		throw new RecordCommandError(
			"observation_roster_mismatch",
			`Expected ${PRODUCTION_MODEL_STEPS.length} live observations, received ${observations.length}`,
		);
	}
	const [mainStoryWrite, mainStoryCopyedit, announcementsWrite, announcementsCopyedit] = await Promise.all([
		recordedResponse("main_story_write", observations[0], config.production_steps.main_story_write),
		recordedResponse("main_story_copyedit", observations[1], config.production_steps.main_story_copyedit),
		recordedResponse("announcements_write", observations[2], config.production_steps.announcements_write),
		recordedResponse("announcements_copyedit", observations[3], config.production_steps.announcements_copyedit),
	]);
	return {
		main_story_write: mainStoryWrite,
		main_story_copyedit: mainStoryCopyedit,
		announcements_write: announcementsWrite,
		announcements_copyedit: announcementsCopyedit,
	};
}

async function writeRecordedResponses(
	directory: string,
	roster: RecordedModelResponseRoster,
): Promise<void> {
	await Promise.all(PRODUCTION_MODEL_STEPS.map((step) =>
		writeFile(join(directory, `${step}.json`), `${JSON.stringify(roster[step], null, 2)}\n`, { flag: "wx" }),
	));
}

export async function recordCommand(options: RecordCommandOptions): Promise<RecordCommandResult> {
	const config = await loadConfig(options.configPath);
	assertRecorderConfig(config);
	const environment = options.environment ?? process.env;
	const liveProviders = resolveRecorderProviders(config, environment);
	const loadedFixture = await loadFixture(options.fixturePath);
	const preparedEvidence = prepareEvidence({
		activeRegionId: loadedFixture.fixture.active_region_id,
		publicationDate: loadedFixture.publicationDate,
		messages: loadedFixture.fixture.messages,
	});

	const lock = await acquireRecorderLock(options.responseDirectory);
	let stagingDirectory: string | undefined;
	try {
		await recoverRecordedResponseDirectory(options.responseDirectory);
		stagingDirectory = await createRecordedResponseStagingDirectory(options.responseDirectory);

		const liveExecution = await executeProductionSteps(preparedEvidence, liveProviders);
		const roster = await recordedResponseRoster(config, liveExecution.observations);
		await writeRecordedResponses(stagingDirectory, roster);
		const stagedRoster = await validateRecordedResponseDirectory(stagingDirectory);

		const replayProvider = createRecordedModelProvider(stagedRoster);
		const replayExecution = await executeProductionSteps(
			preparedEvidence,
			replayProviderRoster(replayProvider),
		);
		const comparison = compareFinalEditorialProducts(liveExecution.products, replayExecution.products);
		if (comparison.differences.length > 0) {
			throw new RecordCommandError(
				"final_product_mismatch",
				`Recorded replay differs from the live final editorial products`,
			);
		}
		await promoteRecordedResponseDirectory({
			stagingDirectory,
			targetDirectory: options.responseDirectory,
		});
		stagingDirectory = undefined;

		return {
			responseDirectory: options.responseDirectory,
			recordedResponses: roster,
			liveProducts: liveExecution.products,
			liveDiagnostics: liveExecution.diagnostics,
			replayProducts: replayExecution.products,
			replayDiagnostics: replayExecution.diagnostics,
			comparison,
		};
	} finally {
		try {
			if (stagingDirectory !== undefined) {
				await removeRecordedResponseStagingDirectory(stagingDirectory);
			}
		} finally {
			await lock.release();
		}
	}
}
