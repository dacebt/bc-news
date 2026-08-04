import { z } from "zod";
import { ActiveRegionIdSchema } from "./active-region-id";
import { PublicationDateSchema } from "./publication-date";

export const GenerationRunParamsSchema = z.strictObject({
	active_region_id: ActiveRegionIdSchema,
	publication_date: PublicationDateSchema,
});

export type GenerationRunParams = z.infer<typeof GenerationRunParamsSchema>;
