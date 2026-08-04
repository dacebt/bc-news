import {
	SYSTEM_CONSTRAINTS,
	buildAnnouncementsPrompt,
	buildMainStoryPrompt,
	buildPackagingPrompt,
	parseAnnouncementsOutput,
	parseMainStoryOutput,
	parsePackagingOutput,
	type AnnouncementsOutput,
	type EditorialCapability,
	type MainStoryOutput,
	type PackagingOutput,
	type PreparedEvidence,
} from "@bc-news/generation-core";

export type CapabilityOutput = MainStoryOutput | AnnouncementsOutput | PackagingOutput;

export interface IndependentCapabilityRunner {
	readonly system: string;
	buildPrompt(preparedEvidence: PreparedEvidence): string;
	parseOutput(rawText: string): MainStoryOutput | AnnouncementsOutput;
}

export const CAPABILITY_ROSTER = ["main_story", "announcements", "packaging"] as const satisfies readonly EditorialCapability[];

export const independentCapabilityRunners = {
	main_story: {
		system: SYSTEM_CONSTRAINTS,
		buildPrompt: buildMainStoryPrompt,
		parseOutput: parseMainStoryOutput,
	},
	announcements: {
		system: SYSTEM_CONSTRAINTS,
		buildPrompt: buildAnnouncementsPrompt,
		parseOutput: parseAnnouncementsOutput,
	},
} as const satisfies Record<"main_story" | "announcements", IndependentCapabilityRunner>;

export const packagingCapabilityRunner = {
	system: SYSTEM_CONSTRAINTS,
	buildPrompt(
		preparedEvidence: PreparedEvidence,
		mainStory: MainStoryOutput,
		announcements: AnnouncementsOutput,
	): string {
		return buildPackagingPrompt(mainStory, announcements, {
			activeRegionId: preparedEvidence.active_region_id,
			publicationDate: preparedEvidence.publication_date,
		});
	},
	parseOutput: parsePackagingOutput,
};
