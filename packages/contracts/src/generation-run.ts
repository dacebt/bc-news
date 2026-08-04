import { z } from "zod";
import { PublicationDateSchema } from "./publication-date";

// Region ids are numeric game identifiers, and active_region_id is interpolated into
// prompt text outside the untrusted-data fence (see generation-core's prompt builders),
// so this character class doubles as the injection boundary: a digits-only id cannot
// carry a newline, a fence marker, or any instruction text into the prompt.
export const ActiveRegionIdSchema = z.string().regex(/^\d{1,10}$/);

export const GenerationRunParamsSchema = z.strictObject({
	active_region_id: ActiveRegionIdSchema,
	publication_date: PublicationDateSchema,
});

export type GenerationRunParams = z.infer<typeof GenerationRunParamsSchema>;
