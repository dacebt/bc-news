import { z } from "zod";

export const CURRENT_PRODUCTION_MODEL_STEPS = [
	"main_story_write",
	"announcements_write",
] as const;

export type CurrentProductionModelStep =
	(typeof CURRENT_PRODUCTION_MODEL_STEPS)[number];

export const CurrentProductionModelStepSchema = z.enum(
	CURRENT_PRODUCTION_MODEL_STEPS,
);

export const CURRENT_OUTPUT_CONTRACT_NAMES = {
	main_story_write: "main_story_write_output",
	announcements_write: "announcements_write_output",
} as const satisfies Record<CurrentProductionModelStep, string>;
