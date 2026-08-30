import {
	CURRENT_EDITION_VERSION,
	EditionSchema,
	type Edition,
} from "@bc-news/contracts";
import type { AnnouncementsProduct } from "./announcements";
import type { MainStoryProduct } from "./main-story";
import {
	PRODUCTION_MODEL_STEPS,
	ProductionModelUsageRosterSchema,
} from "./model-usage";
import type { ModelUsageRecord } from "./ports";
import type { PreparedEvidence } from "./prepared-evidence";

export function assembleEdition(input: {
	mainStory: MainStoryProduct;
	announcements: AnnouncementsProduct;
	preparedEvidence: PreparedEvidence;
	generatedAtUtc: string;
	modelUsages: readonly ModelUsageRecord[];
}): Edition {
	const modelUsages = ProductionModelUsageRosterSchema.parse(input.modelUsages);
	const provenance = Object.fromEntries(
		PRODUCTION_MODEL_STEPS.map((productionStep, index) => {
			const usage = modelUsages[index]!;
			return [productionStep, { provider: usage.provider, model: usage.model }];
		}),
	) as Record<(typeof PRODUCTION_MODEL_STEPS)[number], { provider: string; model: string }>;

	return EditionSchema.parse({
		version: CURRENT_EDITION_VERSION,
		active_region_id: input.preparedEvidence.active_region_id,
		publication_date: input.preparedEvidence.publication_date,
		title: input.mainStory.title,
		game_references: input.preparedEvidence.game_references,
		announcements: input.announcements.announcements,
		main_story: input.mainStory.main_story,
		meta: {
			generated_at_utc: input.generatedAtUtc,
			editorial_products: {
				main_story: provenance.main_story_write,
				announcements: provenance.announcements_write,
			},
			counts: {
				raw_count: input.preparedEvidence.raw_count,
				after_filter_count: input.preparedEvidence.after_filter_count,
				after_burst_count: input.preparedEvidence.after_burst_count,
				final_count: input.preparedEvidence.final_count,
			},
		},
	});
}
