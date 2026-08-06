import { relative } from "node:path";
import { assembleEdition, prepareEvidence, type ProductionModelStep } from "@bc-news/generation-core";
import { loadConfig } from "./config";
import { loadFixture } from "./evidence-fixture";
import { resolveModelProvider, type ModelProviderEnvironment } from "./model-adapters";
import { assertFinalProductChecks } from "./product-checks";
import { executeProductionSteps } from "./production-step-runners";
import { generateRunId, saveRunFile, type RunFile } from "./run-file";

const WORKSPACE_ROOT = new URL("../../../", import.meta.url).pathname;

export interface RunCommandOptions {
	readonly fixturePath: string;
	readonly configPath: string;
	readonly resultsDirectory: string;
	readonly environment?: ModelProviderEnvironment;
}

export async function runCommand(options: RunCommandOptions): Promise<{ path: string; run: RunFile }> {
	const config = await loadConfig(options.configPath);
	const environment = options.environment ?? process.env;
	const loadedFixture = await loadFixture(options.fixturePath);
	const preparedEvidence = prepareEvidence({
		activeRegionId: loadedFixture.fixture.active_region_id,
		publicationDate: loadedFixture.publicationDate,
		messages: loadedFixture.fixture.messages,
	});
	const providers = Object.fromEntries(
		Object.entries(config.production_steps).map(([step, adapter]) => [
			step,
			resolveModelProvider(step as ProductionModelStep, adapter, environment),
		]),
	) as Record<ProductionModelStep, ReturnType<typeof resolveModelProvider>>;
	const startedAt = new Date().toISOString();
	const execution = await executeProductionSteps(preparedEvidence, providers);
	assertFinalProductChecks(execution.products.mainStory, execution.products.announcements, preparedEvidence);

	const edition = assembleEdition({
		mainStory: execution.products.mainStory,
		announcements: execution.products.announcements,
		preparedEvidence,
		generatedAtUtc: new Date().toISOString(),
		modelUsages: execution.steps.map((step) => step.model_usage),
	});
	const run: RunFile = {
		id: generateRunId(),
		config,
		fixture: {
			path: relative(WORKSPACE_ROOT, options.fixturePath),
			fixture_sha256: loadedFixture.fixtureSha256,
		},
		steps: [...execution.steps],
		edition,
		started_at: startedAt,
		completed_at: new Date().toISOString(),
	};
	const path = await saveRunFile(run, options.resultsDirectory);
	return { path, run };
}
