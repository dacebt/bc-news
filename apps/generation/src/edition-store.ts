import { EditionSchema, type Edition } from "@bc-news/contracts";

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

export async function publishEdition(
	db: D1Database,
	edition: Edition,
	publishedAtUtc: string,
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO edition (active_region_id, publication_date, status, document_json, published_at_utc)
			 VALUES (?1, ?2, 'published', ?3, ?4)
			 ON CONFLICT (active_region_id, publication_date) DO NOTHING`,
		)
		.bind(
			edition.active_region_id,
			edition.publication_date,
			JSON.stringify(edition),
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
	const result = EditionSchema.safeParse(document);
	if (!result.success) {
		throw new EditionUnreadableError(activeRegionId, publicationDate, result.error);
	}
	return result.data;
}
