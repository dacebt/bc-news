import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
	RecordedModelResponseSchema,
	modelRequestSha256,
	type RecordedModelResponse,
} from "@bc-news/fixtures";
import {
	COPYEDIT_SYSTEM_CONSTRAINTS,
	PRODUCTION_MODEL_STEPS,
	WRITER_SYSTEM_CONSTRAINTS,
	assembleEdition,
	attachAnnouncementIds,
	buildAnnouncementsCopyeditPrompt,
	buildAnnouncementsWriterPrompt,
	buildMainStoryCopyeditPrompt,
	buildMainStoryWriterPrompt,
	parseAnnouncementsCopyeditOutput,
	parseAnnouncementsWriterOutput,
	parseMainStoryCopyeditOutput,
	parseMainStoryWriterOutput,
	prepareEvidence,
	type ProductionModelStep,
} from "@bc-news/generation-core";
import { allDifferences } from "./run-difference";
import { loadFixture } from "./evidence-fixture";
import type { RunFile } from "./run-file";

const WORKSPACE_ROOT = new URL("../../../", import.meta.url).pathname;
const RESPONSE_DIRECTORY = join(WORKSPACE_ROOT, "packages", "fixtures", "model-responses");

async function assertResponseDirectoryLayout(): Promise<void> {
	const expected = PRODUCTION_MODEL_STEPS.map((step) => `${step}.json`).sort();
	const observed = (await readdir(RESPONSE_DIRECTORY, { withFileTypes: true }))
		.map((entry) => entry.name)
		.sort();
	if (JSON.stringify(observed) !== JSON.stringify(expected)) {
		throw new Error(`recorded response directory must contain exactly ${expected.join(", ")}`);
	}
}

async function readRecordedResponse(step: ProductionModelStep): Promise<RecordedModelResponse> {
	const raw = await readFile(join(RESPONSE_DIRECTORY, `${step}.json`), "utf8");
	const parsed = RecordedModelResponseSchema.parse(JSON.parse(raw) as unknown);
	if (parsed.production_step !== step) throw new Error(`${step} fixture declares ${parsed.production_step}`);
	return parsed;
}

export async function assertCanonicalEvalGrounding(run: RunFile, fixturePath: string): Promise<void> {
	await assertResponseDirectoryLayout();
	const loaded = await loadFixture(fixturePath);
	if (run.fixture.fixture_sha256 !== loaded.fixtureSha256) {
		throw new Error("canonical run fixture digest does not name the consumed evidence bytes");
	}
	const prepared = prepareEvidence({
		activeRegionId: loaded.fixture.active_region_id,
		publicationDate: loaded.publicationDate,
		messages: loaded.fixture.messages,
	});
	const records = Object.fromEntries(await Promise.all(
		PRODUCTION_MODEL_STEPS.map(async (step) => [step, await readRecordedResponse(step)] as const),
	)) as Record<ProductionModelStep, RecordedModelResponse>;

	const mainStoryDraft = parseMainStoryWriterOutput(records.main_story_write.text);
	const identifiedAnnouncements = attachAnnouncementIds(
		parseAnnouncementsWriterOutput(records.announcements_write.text),
	);
	const mainStory = parseMainStoryCopyeditOutput(records.main_story_copyedit.text, mainStoryDraft);
	const announcements = parseAnnouncementsCopyeditOutput(
		records.announcements_copyedit.text,
		identifiedAnnouncements,
	);
	const requests: Readonly<Record<ProductionModelStep, { readonly system: string; readonly user: string }>> = {
		main_story_write: {
			system: WRITER_SYSTEM_CONSTRAINTS,
			user: buildMainStoryWriterPrompt(prepared),
		},
		main_story_copyedit: {
			system: COPYEDIT_SYSTEM_CONSTRAINTS,
			user: buildMainStoryCopyeditPrompt(mainStoryDraft),
		},
		announcements_write: {
			system: WRITER_SYSTEM_CONSTRAINTS,
			user: buildAnnouncementsWriterPrompt(prepared),
		},
		announcements_copyedit: {
			system: COPYEDIT_SYSTEM_CONSTRAINTS,
			user: buildAnnouncementsCopyeditPrompt(identifiedAnnouncements),
		},
	};
	const expectedOutputs: Readonly<Record<ProductionModelStep, unknown>> = {
		main_story_write: mainStoryDraft,
		main_story_copyedit: mainStory,
		announcements_write: parseAnnouncementsWriterOutput(records.announcements_write.text),
		announcements_copyedit: announcements,
	};

	for (const [index, productionStep] of PRODUCTION_MODEL_STEPS.entries()) {
		const step = run.steps[index]!;
		const requestStamp = await modelRequestSha256(requests[productionStep]);
		if (records[productionStep].prompt_sha256 !== requestStamp) {
			throw new Error(`${productionStep} fixture request stamp does not match the current dependent request`);
		}
		if (step.prompt_sha256 !== requestStamp) {
			throw new Error(`${productionStep} run request stamp does not match the current dependent request`);
		}
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

	const expectedEdition = assembleEdition({
		mainStory,
		announcements,
		preparedEvidence: prepared,
		generatedAtUtc: run.edition.meta.generated_at_utc,
		modelUsages: run.steps.map((step) => step.model_usage),
	});
	const editionDifferences = allDifferences(run.edition, expectedEdition);
	if (editionDifferences.length > 0) {
		throw new Error(`canonical edition was not deterministically assembled: ${editionDifferences.join(", ")}`);
	}
}
