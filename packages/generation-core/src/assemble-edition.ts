import { EditionSchema, type Announcement, type Edition, type MainStory } from "@bc-news/contracts";
import type { PreparedEvidence } from "./prepared-evidence";

export function assembleEdition(input: {
	activeRegionId: string;
	publicationDate: string;
	title: string;
	subtitle: string;
	mainStory: MainStory;
	announcements: Announcement[];
	preparedEvidence: PreparedEvidence;
	mainStoryProvenance: { provider: string; model: string };
	announcementsProvenance: { provider: string; model: string };
	packagingProvenance: { provider: string; model: string };
	generatedAtUtc: string;
}): Edition {
	return EditionSchema.parse({
		active_region_id: input.activeRegionId,
		publication_date: input.publicationDate,
		title: input.title,
		subtitle: input.subtitle,
		announcements: input.announcements,
		main_story: input.mainStory,
		meta: {
			generated_at_utc: input.generatedAtUtc,
			editorial_capabilities: {
				main_story: input.mainStoryProvenance,
				announcements: input.announcementsProvenance,
				packaging: input.packagingProvenance,
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
