import { z } from "zod";
import { ActiveRegionIdSchema } from "./active-region-id";
import { PublicationDateSchema } from "./publication-date";

export const CURRENT_EDITION_VERSION = 3;

export const AnnouncementSchema = z.strictObject({
	title: z.string().min(1),
	summary: z.string().min(1),
});

export type Announcement = z.infer<typeof AnnouncementSchema>;

const LegacyMainStoryImageSchema = z.strictObject({
	url: z.string(),
	caption: z.string(),
	credit: z.string().optional(),
});

export const MainStorySchema = z.strictObject({
	headline: z.string().min(1),
	lede: z.string().min(1),
	body: z.string().min(1),
});

export type MainStory = z.infer<typeof MainStorySchema>;

export const LegacyMainStorySchema = MainStorySchema.extend({
	image: LegacyMainStoryImageSchema.optional(),
});

export type LegacyMainStory = z.infer<typeof LegacyMainStorySchema>;

export const ModelProvenanceSchema = z.strictObject({
	provider: z.string().min(1),
	model: z.string().min(1),
});

export type ModelProvenance = z.infer<typeof ModelProvenanceSchema>;

export const EditorialProductProvenanceSchema = ModelProvenanceSchema;

export type EditorialProductProvenance = z.infer<typeof EditorialProductProvenanceSchema>;

export const LegacyEditorialProductProvenanceSchema = z.strictObject({
	write: ModelProvenanceSchema,
	copyedit: ModelProvenanceSchema,
});

export type LegacyEditorialProductProvenance = z.infer<typeof LegacyEditorialProductProvenanceSchema>;

export function coordGameReferenceDestination(northing: number, easting: number): string {
	return `https://bitcraftmap.com/?center=${northing},${easting}&zoom=3.0`;
}

export const GameReferenceEntityKindSchema = z.enum([
	"item",
	"cargo",
	"claim",
	"coll",
	"res",
]);

export type GameReferenceEntityKind = z.infer<typeof GameReferenceEntityKindSchema>;

export const GameReferenceEntityIdSchema = z.string().regex(/^[1-9][0-9]*$/u);

export type GameReferenceEntityId = z.infer<typeof GameReferenceEntityIdSchema>;

export function entityGameReferenceDestination(
	kind: GameReferenceEntityKind,
	id: GameReferenceEntityId,
): string {
	switch (kind) {
		case "item":
			return `https://bitjita.com/items/${id}`;
		case "cargo":
			return `https://bitjita.com/cargo/${id}`;
		case "claim":
			return `https://bitjita.com/claims/${id}`;
		case "coll":
			return `https://bitjita.com/collectibles/${id}`;
		case "res":
			return `https://bitjita.com/resources/${id}`;
	}
}

export const GameReferenceTokenSchema = z.string().regex(/^\[\[GAME_REF_\d{3,}\]\]$/u);

export const CoordinateGameReferenceSchema = z.strictObject({
	token: GameReferenceTokenSchema,
	kind: z.literal("coord"),
	northing: z.int().nonnegative(),
	easting: z.int().nonnegative(),
	display_text: z.string().min(1),
	destination_url: z.url(),
}).superRefine((reference, context) => {
	if (
		reference.destination_url !==
		coordGameReferenceDestination(reference.northing, reference.easting)
	) {
		context.addIssue({
			code: "custom",
			path: ["destination_url"],
			message: "coordinate game reference destination must match the exact focused BitCraft Map URL",
		});
	}
});

export type CoordinateGameReference = z.infer<typeof CoordinateGameReferenceSchema>;

export const EntityGameReferenceSchema = z.strictObject({
	token: GameReferenceTokenSchema,
	kind: GameReferenceEntityKindSchema,
	id: GameReferenceEntityIdSchema,
	display_text: z.string().min(1),
	destination_url: z.url(),
}).superRefine((reference, context) => {
	if (
		reference.destination_url !==
		entityGameReferenceDestination(reference.kind, reference.id)
	) {
		context.addIssue({
			code: "custom",
			path: ["destination_url"],
			message: "entity game reference destination must match the exact BitJita URL for its kind and id",
		});
	}
});

export type EntityGameReference = z.infer<typeof EntityGameReferenceSchema>;

export const GameReferenceSchema = z.union([
	CoordinateGameReferenceSchema,
	EntityGameReferenceSchema,
]);

export type GameReference = z.infer<typeof GameReferenceSchema>;

export function gameReferenceDestination(reference: GameReference): string {
	switch (reference.kind) {
		case "coord":
			return coordGameReferenceDestination(reference.northing, reference.easting);
		case "item":
		case "cargo":
		case "claim":
		case "coll":
		case "res":
			return entityGameReferenceDestination(reference.kind, reference.id);
	}
}

export const GameReferenceRosterSchema = z.array(GameReferenceSchema).superRefine(
	(references, context) => {
		const firstIndexByToken = new Map<string, number>();
		for (const [index, reference] of references.entries()) {
			const firstIndex = firstIndexByToken.get(reference.token);
			if (firstIndex !== undefined) {
				context.addIssue({
					code: "custom",
					path: [index, "token"],
					message: `game reference token duplicates roster entry ${String(firstIndex + 1)}`,
				});
				continue;
			}
			firstIndexByToken.set(reference.token, index);
		}
	},
);

const EditionCountsSchema = z.strictObject({
	raw_count: z.int().nonnegative(),
	after_filter_count: z.int().nonnegative(),
	after_burst_count: z.int().nonnegative(),
	final_count: z.int().nonnegative(),
});

const CurrentEditorialProductsSchema = z.strictObject({
	main_story: ModelProvenanceSchema,
	announcements: ModelProvenanceSchema,
});

const CurrentEditionFields = {
	active_region_id: ActiveRegionIdSchema,
	publication_date: PublicationDateSchema,
	title: z.string().min(1),
	announcements: z.array(AnnouncementSchema),
	main_story: MainStorySchema,
	meta: z.strictObject({
		generated_at_utc: z.iso.datetime({ offset: true }),
		editorial_products: CurrentEditorialProductsSchema,
		counts: EditionCountsSchema,
	}),
} as const;

export const EditionSchema = z.strictObject({
	version: z.literal(CURRENT_EDITION_VERSION),
	game_references: GameReferenceRosterSchema,
	...CurrentEditionFields,
});

export type Edition = z.infer<typeof EditionSchema>;

export const VersionedEditionV2Schema = z.strictObject({
	version: z.literal(2),
	active_region_id: ActiveRegionIdSchema,
	publication_date: PublicationDateSchema,
	title: z.string().min(1),
	announcements: z.array(AnnouncementSchema),
	main_story: MainStorySchema,
	meta: z.strictObject({
		generated_at_utc: z.iso.datetime({ offset: true }),
		editorial_products: CurrentEditorialProductsSchema,
		counts: EditionCountsSchema,
	}),
});

export type VersionedEditionV2 = z.infer<typeof VersionedEditionV2Schema>;

export const LegacyEditionSchema = z.strictObject({
	active_region_id: ActiveRegionIdSchema,
	publication_date: PublicationDateSchema,
	title: z.string().min(1),
	subtitle: z.string().min(1),
	announcements: z.array(AnnouncementSchema),
	main_story: LegacyMainStorySchema,
	meta: z.strictObject({
		generated_at_utc: z.iso.datetime({ offset: true }),
		editorial_products: z.strictObject({
			main_story: LegacyEditorialProductProvenanceSchema,
			announcements: LegacyEditorialProductProvenanceSchema,
		}),
		counts: EditionCountsSchema,
	}),
});

export const EditionRecordSchema = z.union([
	EditionSchema,
	VersionedEditionV2Schema,
	LegacyEditionSchema,
]);

export type LegacyEdition = z.infer<typeof LegacyEditionSchema>;
export type EditionRecord = z.infer<typeof EditionRecordSchema>;
