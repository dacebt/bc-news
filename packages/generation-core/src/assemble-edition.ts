import { EditionSchema, type Edition, type MainStory } from "@bc-news/contracts";
import { parseDateParts } from "./evidence-date";
import type { PreparedEvidence } from "./prepared-evidence";

const MONTH_NAMES = [
	"January", "February", "March", "April", "May", "June",
	"July", "August", "September", "October", "November", "December",
] as const;

function mastheadSubtitle(publicationDate: string): string {
	const { year, month, day } = parseDateParts(publicationDate);
	const monthName = MONTH_NAMES[month - 1];
	if (monthName === undefined) {
		throw new Error(`Publication date "${publicationDate}" has no representable month name`);
	}
	return `${monthName} ${day}, ${year}`;
}

export function assembleEdition(input: {
	activeRegionId: string;
	publicationDate: string;
	mainStory: MainStory;
	preparedEvidence: PreparedEvidence;
	mainStoryProvenance: { provider: string; model: string };
	generatedAtUtc: string;
}): Edition {
	return EditionSchema.parse({
		active_region_id: input.activeRegionId,
		publication_date: input.publicationDate,
		title: `Region ${input.activeRegionId} Chronicle`,
		subtitle: mastheadSubtitle(input.publicationDate),
		announcements: [],
		main_story: input.mainStory,
		meta: {
			generated_at_utc: input.generatedAtUtc,
			editorial_capabilities: {
				main_story: input.mainStoryProvenance,
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
