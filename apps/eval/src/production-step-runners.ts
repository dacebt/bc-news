import { modelRequestSha256 } from "@bc-news/fixtures";
import {
	COPYEDIT_SYSTEM_CONSTRAINTS,
	PRODUCTION_MODEL_STEPS,
	WRITER_SYSTEM_CONSTRAINTS,
	attachAnnouncementIds,
	buildAnnouncementsCopyeditPrompt,
	buildAnnouncementsWriterPrompt,
	buildMainStoryCopyeditPrompt,
	buildMainStoryWriterPrompt,
	modelUsageRecord,
	parseAnnouncementsCopyeditOutput,
	parseAnnouncementsWriterOutput,
	parseMainStoryCopyeditOutput,
	parseMainStoryWriterOutput,
	type AnnouncementsProduct,
	type MainStoryProduct,
	type ModelProviderPort,
	type ModelUsageRecord,
	type PreparedEvidence,
	type ProductionModelStep,
} from "@bc-news/generation-core";

export interface EvalStep {
	readonly production_step: ProductionModelStep;
	readonly prompt_sha256: string;
	readonly output: Record<string, unknown>;
	readonly model_usage: ModelUsageRecord;
}

export interface EvalProducts {
	readonly mainStory: MainStoryProduct;
	readonly announcements: AnnouncementsProduct;
}

async function completeStep(input: {
	readonly productionStep: ProductionModelStep;
	readonly provider: ModelProviderPort;
	readonly system: string;
	readonly user: string;
}): Promise<{ readonly text: string; readonly step: EvalStep }> {
	const completion = await input.provider.complete({
		productionStep: input.productionStep,
		system: input.system,
		user: input.user,
	});
	return {
		text: completion.text,
		step: {
			production_step: input.productionStep,
			prompt_sha256: await modelRequestSha256({ system: input.system, user: input.user }),
			output: {},
			model_usage: modelUsageRecord(input.productionStep, completion),
		},
	};
}

export async function executeProductionSteps(
	preparedEvidence: PreparedEvidence,
	providers: Readonly<Record<ProductionModelStep, ModelProviderPort>>,
): Promise<{ readonly steps: readonly EvalStep[]; readonly products: EvalProducts }> {
	const mainStoryWriterUser = buildMainStoryWriterPrompt(preparedEvidence);
	const mainStoryWriter = await completeStep({
		productionStep: "main_story_write",
		provider: providers.main_story_write,
		system: WRITER_SYSTEM_CONSTRAINTS,
		user: mainStoryWriterUser,
	});
	const mainStoryDraft = parseMainStoryWriterOutput(mainStoryWriter.text);

	const mainStoryCopyeditUser = buildMainStoryCopyeditPrompt(mainStoryDraft);
	const mainStoryCopyedit = await completeStep({
		productionStep: "main_story_copyedit",
		provider: providers.main_story_copyedit,
		system: COPYEDIT_SYSTEM_CONSTRAINTS,
		user: mainStoryCopyeditUser,
	});
	const mainStory = parseMainStoryCopyeditOutput(mainStoryCopyedit.text, mainStoryDraft);

	const announcementsWriterUser = buildAnnouncementsWriterPrompt(preparedEvidence);
	const announcementsWriter = await completeStep({
		productionStep: "announcements_write",
		provider: providers.announcements_write,
		system: WRITER_SYSTEM_CONSTRAINTS,
		user: announcementsWriterUser,
	});
	const announcementsDraft = parseAnnouncementsWriterOutput(announcementsWriter.text);
	const identifiedAnnouncements = attachAnnouncementIds(announcementsDraft);

	const announcementsCopyeditUser = buildAnnouncementsCopyeditPrompt(identifiedAnnouncements);
	const announcementsCopyedit = await completeStep({
		productionStep: "announcements_copyedit",
		provider: providers.announcements_copyedit,
		system: COPYEDIT_SYSTEM_CONSTRAINTS,
		user: announcementsCopyeditUser,
	});
	const announcements = parseAnnouncementsCopyeditOutput(
		announcementsCopyedit.text,
		identifiedAnnouncements,
	);

	const outputs: Readonly<Record<ProductionModelStep, Record<string, unknown>>> = {
		main_story_write: mainStoryDraft,
		main_story_copyedit: mainStory,
		announcements_write: announcementsDraft,
		announcements_copyedit: announcements,
	};
	const completed = [
		mainStoryWriter.step,
		mainStoryCopyedit.step,
		announcementsWriter.step,
		announcementsCopyedit.step,
	];
	return {
		steps: PRODUCTION_MODEL_STEPS.map((productionStep, index) => ({
			...completed[index]!,
			output: outputs[productionStep],
		})),
		products: { mainStory, announcements },
	};
}
