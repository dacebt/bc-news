import { relative } from "node:path";
import { assembleEdition } from "@bc-news/generation-core";
import { loadConfig, loadLiveEvaluationConfig, type EvalConfig } from "./config";
import { type CurrentProductionModelStep } from "./current-production-steps";
import { loadFixture } from "./evidence-fixture";
import { prepareFixtureEvidenceWithGameReferences } from "./fixture-prepared-evidence";
import { resolveModelProvider, type ModelProviderEnvironment } from "./model-adapters";
import { executeProductionSteps } from "./production-step-runners";
import { generateRunId, saveRunFile, type RunFile } from "./run-file";

const WORKSPACE_ROOT = new URL("../../../", import.meta.url).pathname;

export interface RunCommandOptions {
	readonly fixturePath: string;
	readonly configPath: string;
	readonly resultsDirectory: string;
	readonly environment?: ModelProviderEnvironment;
	readonly correlateProviderRequests?: boolean;
}

async function executeRunCommand(
	options: RunCommandOptions,
	config: EvalConfig,
): Promise<{ path: string; run: RunFile }> {
	const environment = options.environment ?? process.env;
	const loadedFixture = await loadFixture(options.fixturePath);
	const preparedEvidence = await prepareFixtureEvidenceWithGameReferences({
		activeRegionId: loadedFixture.fixture.active_region_id,
		publicationDate: loadedFixture.publicationDate,
		messages: loadedFixture.fixture.messages,
	});
	const providers = Object.fromEntries(
		Object.entries(config.production_steps).map(([step, adapter]) => [
			step,
			resolveModelProvider(step as CurrentProductionModelStep, adapter, environment),
		]),
	) as Record<CurrentProductionModelStep, ReturnType<typeof resolveModelProvider>>;
	const runId = generateRunId();
	const startedAt = new Date().toISOString();
	const execution = await executeProductionSteps(
		preparedEvidence,
		providers,
		options.correlateProviderRequests === true ? { correlationRunId: runId } : {},
	);

	const edition = assembleEdition({
		mainStory: execution.products.mainStory,
		announcements: execution.products.announcements,
		preparedEvidence,
		generatedAtUtc: new Date().toISOString(),
		modelUsages: execution.steps.map((step) => step.model_usage),
	});
	const run: RunFile = {
		id: runId,
		config,
		fixture: {
			path: relative(WORKSPACE_ROOT, options.fixturePath),
			fixture_sha256: loadedFixture.fixtureSha256,
		},
		steps: [...execution.steps],
		edition,
		diagnostics: [...execution.diagnostics],
		started_at: startedAt,
		completed_at: new Date().toISOString(),
	};
	const path = await saveRunFile(run, options.resultsDirectory);
	return { path, run };
}

export async function runCommand(options: RunCommandOptions): Promise<{ path: string; run: RunFile }> {
	return executeRunCommand(options, await loadConfig(options.configPath));
}

export async function runLiveCommand(options: RunCommandOptions): Promise<{ path: string; run: RunFile }> {
	return executeRunCommand(options, await loadLiveEvaluationConfig(options.configPath));
}
