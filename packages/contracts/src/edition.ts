import { z } from "zod";
import { ActiveRegionIdSchema } from "./active-region-id";
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

export const ModelProvenanceSchema = z.strictObject({
	provider: z.string().min(1),
	model: z.string().min(1),
});

export type ModelProvenance = z.infer<typeof ModelProvenanceSchema>;

export const EditorialProductProvenanceSchema = z.strictObject({
	write: ModelProvenanceSchema,
	copyedit: ModelProvenanceSchema,
});

export type EditorialProductProvenance = z.infer<typeof EditorialProductProvenanceSchema>;

export const EditionSchema = z.strictObject({
	active_region_id: ActiveRegionIdSchema,
	publication_date: PublicationDateSchema,
	title: z.string().min(1),
	subtitle: z.string().min(1),
	announcements: z.array(AnnouncementSchema),
	main_story: MainStorySchema,
	meta: z.strictObject({
		generated_at_utc: z.iso.datetime({ offset: true }),
		editorial_products: z.strictObject({
			main_story: EditorialProductProvenanceSchema,
			announcements: EditorialProductProvenanceSchema,
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
