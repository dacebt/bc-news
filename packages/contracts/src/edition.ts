import { z } from "zod";
import { PublicationDateSchema } from "./publication-date";

export const AnnouncementSchema = z.strictObject({
	title: z.string().min(1),
	summary: z.string().min(1),
});

export type Announcement = z.infer<typeof AnnouncementSchema>;

export const MainStorySchema = z.strictObject({
	headline: z.string().min(1),
	lede: z.string().min(1),
	body: z.string().min(1),
	image: z.strictObject({
		url: z.string(),
		caption: z.string(),
		credit: z.string().optional(),
	}).optional(),
});

export type MainStory = z.infer<typeof MainStorySchema>;

const EditorialCapabilityProvenanceSchema = z.strictObject({
	provider: z.string().min(1),
	model: z.string().min(1),
});

export const EditionSchema = z.strictObject({
	active_region_id: z.string().min(1),
	publication_date: PublicationDateSchema,
	title: z.string().min(1),
	subtitle: z.string().min(1),
	announcements: z.array(AnnouncementSchema),
	main_story: MainStorySchema,
	meta: z.strictObject({
		generated_at_utc: z.iso.datetime({ offset: true }),
		editorial_capabilities: z.strictObject({
			main_story: EditorialCapabilityProvenanceSchema,
			announcements: EditorialCapabilityProvenanceSchema,
			packaging: EditorialCapabilityProvenanceSchema,
		}),
		counts: z.strictObject({
			raw_count: z.int().nonnegative(),
			after_filter_count: z.int().nonnegative(),
			after_burst_count: z.int().nonnegative(),
			final_count: z.int().nonnegative(),
		}),
	}),
});

export type Edition = z.infer<typeof EditionSchema>;
