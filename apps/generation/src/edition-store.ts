import {
	CURRENT_EDITION_VERSION,
	EditionRecordSchema,
	EditionSchema,
	LegacyEditionSchema,
	VersionedEditionV2Schema,
	type Edition,
	type EditionRecord,
} from "@bc-news/contracts";

export class EditionUnreadableError extends Error {
	readonly code = "edition_unreadable";

	constructor(activeRegionId: string, publicationDate: string, cause: unknown) {
		super(
			`Published edition for active region ${activeRegionId} on ${publicationDate} fails the edition contract on read-back`,
			{ cause },
		);
		this.name = "EditionUnreadableError";
	}
}

function toCurrentEdition(record: EditionRecord): Edition {
	if ("version" in record) {
		if (record.version === CURRENT_EDITION_VERSION) {
			return EditionSchema.parse(record);
		}
		const prior = VersionedEditionV2Schema.parse(record);
		return EditionSchema.parse({
			version: CURRENT_EDITION_VERSION,
			active_region_id: prior.active_region_id,
			publication_date: prior.publication_date,
			title: prior.title,
			game_references: [],
			announcements: prior.announcements,
			main_story: prior.main_story,
			meta: prior.meta,
		});
	}
	const legacy = LegacyEditionSchema.parse(record);
	return EditionSchema.parse({
		version: CURRENT_EDITION_VERSION,
		active_region_id: legacy.active_region_id,
		publication_date: legacy.publication_date,
		title: legacy.title,
		game_references: [],
		announcements: legacy.announcements,
		main_story: {
			headline: legacy.main_story.headline,
			lede: legacy.main_story.lede,
			body: legacy.main_story.body,
		},
		meta: {
			generated_at_utc: legacy.meta.generated_at_utc,
			editorial_products: {
				main_story: legacy.meta.editorial_products.main_story.write,
				announcements: legacy.meta.editorial_products.announcements.write,
			},
			counts: legacy.meta.counts,
		},
	});
}

export async function publishEdition(
	db: D1Database,
	edition: EditionRecord,
	publishedAtUtc: string,
): Promise<void> {
	const currentEdition = toCurrentEdition(EditionRecordSchema.parse(edition));
	await db
		.prepare(
			`INSERT INTO edition (active_region_id, publication_date, status, document_json, published_at_utc)
			 VALUES (?1, ?2, 'published', ?3, ?4)
			 ON CONFLICT (active_region_id, publication_date) DO NOTHING`,
		)
		.bind(
			currentEdition.active_region_id,
			currentEdition.publication_date,
			JSON.stringify(currentEdition),
			publishedAtUtc,
		)
		.run();
}

export async function readEdition(
	db: D1Database,
	activeRegionId: string,
	publicationDate: string,
): Promise<Edition | undefined> {
	const row = await db
		.prepare(
			`SELECT document_json FROM edition
			 WHERE active_region_id = ?1 AND publication_date = ?2 AND status = 'published'`,
		)
		.bind(activeRegionId, publicationDate)
		.first<{ document_json: string }>();
	if (row === null) {
		return undefined;
	}

	let document: unknown;
	try {
		document = JSON.parse(row.document_json);
	} catch (cause) {
		throw new EditionUnreadableError(activeRegionId, publicationDate, cause);
	}
	const result = EditionRecordSchema.safeParse(document);
	if (result.success) {
		return toCurrentEdition(result.data);
	}
	throw new EditionUnreadableError(activeRegionId, publicationDate, result.error);
}
