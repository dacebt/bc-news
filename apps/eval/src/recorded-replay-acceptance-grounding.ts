import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
	RecordedModelResponseSchema,
	type RecordedModelResponse,
} from "@bc-news/fixtures";
import {
	announcementsFinalProductDiagnostics,
	assembleEdition,
	mainStoryFinalProductDiagnostics,
	parseAnnouncementsWriterOutput,
	parseMainStoryWriterOutput,
	prepareEvidence,
} from "@bc-news/generation-core";
import { CURRENT_PRODUCTION_MODEL_STEPS } from "./current-production-steps";
import { allDifferences } from "./run-difference";
import { loadFixture } from "./evidence-fixture";
import type { RunFile } from "./run-file";

const WORKSPACE_ROOT = new URL("../../../", import.meta.url).pathname;
const RESPONSE_DIRECTORY = join(WORKSPACE_ROOT, "packages", "fixtures", "model-responses");

async function assertResponseDirectoryLayout(): Promise<void> {
	const expected = CURRENT_PRODUCTION_MODEL_STEPS.map((step) => `${step}.json`).sort();
	const observed = (await readdir(RESPONSE_DIRECTORY, { withFileTypes: true }))
		.map((entry) => entry.name)
		.sort();
	if (JSON.stringify(observed) !== JSON.stringify(expected)) {
		throw new Error(`recorded response directory must contain exactly ${expected.join(", ")}`);
	}
}

async function readRecordedResponse(
	step: (typeof CURRENT_PRODUCTION_MODEL_STEPS)[number],
): Promise<RecordedModelResponse> {
	const raw = await readFile(join(RESPONSE_DIRECTORY, `${step}.json`), "utf8");
	const parsed = RecordedModelResponseSchema.parse(JSON.parse(raw) as unknown);
	if (parsed.production_step !== step) throw new Error(`${step} fixture declares ${parsed.production_step}`);
	return parsed;
}

export async function assertRecordedReplayAcceptanceGrounding(run: RunFile, fixturePath: string): Promise<void> {
	await assertResponseDirectoryLayout();
	const loaded = await loadFixture(fixturePath);
	if (run.fixture.fixture_sha256 !== loaded.fixtureSha256) {
		throw new Error("recorded-replay acceptance fixture digest does not name the consumed evidence bytes");
	}
	const prepared = prepareEvidence({
		activeRegionId: loaded.fixture.active_region_id,
		publicationDate: loaded.publicationDate,
		messages: loaded.fixture.messages,
	});
	const records = Object.fromEntries(await Promise.all(
		CURRENT_PRODUCTION_MODEL_STEPS.map(async (step) => [step, await readRecordedResponse(step)] as const),
	)) as Record<(typeof CURRENT_PRODUCTION_MODEL_STEPS)[number], RecordedModelResponse>;

	const mainStory = parseMainStoryWriterOutput(
		records.main_story_write.text,
		prepared,
	);
	const announcements = parseAnnouncementsWriterOutput(
		records.announcements_write.text,
		prepared,
	);
	const expectedDiagnostics = [
		...mainStoryFinalProductDiagnostics(mainStory, prepared),
		...announcementsFinalProductDiagnostics(announcements, prepared),
	];
	const expectedOutputs: Readonly<
		Record<(typeof CURRENT_PRODUCTION_MODEL_STEPS)[number], unknown>
	> = {
		main_story_write: mainStory,
		announcements_write: announcements,
	};

	for (const [index, productionStep] of CURRENT_PRODUCTION_MODEL_STEPS.entries()) {
		const step = run.steps[index]!;
		const differences = allDifferences(step.output, expectedOutputs[productionStep]);
		if (differences.length > 0) {
			throw new Error(`${productionStep} output differs from its parsed recorded response at ${differences.join(", ")}`);
		}
		if (
			step.model_usage.provider !== records[productionStep].provider
			|| step.model_usage.model !== records[productionStep].model
		) {
			throw new Error(`${productionStep} usage does not retain fixture provider/model provenance`);
		}
	}
	const diagnosticDifferences = allDifferences(run.diagnostics, expectedDiagnostics);
	if (diagnosticDifferences.length > 0) {
		throw new Error(`recorded-replay acceptance diagnostics were not retained exactly: ${diagnosticDifferences.join(", ")}`);
	}

	const expectedEdition = assembleEdition({
		mainStory,
		announcements,
		preparedEvidence: prepared,
		generatedAtUtc: run.edition.meta.generated_at_utc,
		modelUsages: run.steps.map((step) => step.model_usage),
	});
	const editionDifferences = allDifferences(run.edition, expectedEdition);
	if (editionDifferences.length > 0) {
		throw new Error(`recorded-replay acceptance edition was not deterministically assembled: ${editionDifferences.join(", ")}`);
	}
}
