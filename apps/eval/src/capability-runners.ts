import {
	SYSTEM_CONSTRAINTS,
	buildMainStoryPrompt,
	parseMainStoryOutput,
	type EditorialCapability,
	type MainStoryOutput,
	type PreparedEvidence,
} from "@bc-news/generation-core";

/**
 * One entry per editorial capability. Prompt building and output parsing
 * come only from @bc-news/generation-core -- apps/eval never forks prompt
 * prose (v1's prompts-as-yaml trap). Announcements and packaging join this
 * roster as additional entries when slice B merges; nothing here restructures.
 */
export interface CapabilityRunner {
	readonly system: string;
	buildPrompt(preparedEvidence: PreparedEvidence): string;
	parseOutput(rawText: string): MainStoryOutput;
}

export const CAPABILITY_ROSTER = ["main_story"] as const satisfies readonly EditorialCapability[];

export const capabilityRunners: Record<EditorialCapability, CapabilityRunner> = {
	main_story: {
		system: SYSTEM_CONSTRAINTS,
		buildPrompt: buildMainStoryPrompt,
		parseOutput: parseMainStoryOutput,
	},
};
