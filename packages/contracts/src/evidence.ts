import { z } from "zod";
import { PublicationDateSchema } from "./publication-date";
import { TimestampMillisecondsSchema } from "./timestamp";

export const EvidenceMessageSchema = z.strictObject({
	id: z.string().min(1),
	ts: TimestampMillisecondsSchema,
	author_id: z.string().min(1),
	author_name: z.string().nullable(),
	text: z.string(),
});

export type EvidenceMessage = z.infer<typeof EvidenceMessageSchema>;

export const EvidenceFixtureSchema = z.strictObject({
	active_region_id: z.string().min(1),
	evidence_date: PublicationDateSchema,
	messages: z.array(EvidenceMessageSchema).min(1),
});

export type EvidenceFixture = z.infer<typeof EvidenceFixtureSchema>;
