import { z } from "zod";
import { PublicationDateSchema } from "./publication-date";

export const GenerationRunParamsSchema = z.strictObject({
	active_region_id: z.string().min(1),
	publication_date: PublicationDateSchema,
});

export type GenerationRunParams = z.infer<typeof GenerationRunParamsSchema>;
