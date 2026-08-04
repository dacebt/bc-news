import { z } from "zod";
import { PublicationDateSchema } from "./publication-date";

// Region IDs become workflow/edition identity and prompt context; canonical
// digits prevent aliases and injection content at the shared boundary.
export const ActiveRegionIdSchema = z.string().regex(/^[1-9]\d{0,9}$/);

export const GenerationRunParamsSchema = z.strictObject({
	active_region_id: ActiveRegionIdSchema,
	publication_date: PublicationDateSchema,
});

export type GenerationRunParams = z.infer<typeof GenerationRunParamsSchema>;
