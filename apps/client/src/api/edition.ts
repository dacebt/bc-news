import { EditionSchema, type Edition } from "@bc-news/contracts";

export async function getEdition(
	activeRegionId: string,
	publicationDate: string,
): Promise<Edition> {
	const query = new URLSearchParams({
		active_region_id: activeRegionId,
		publication_date: publicationDate,
	});
	const response = await fetch(`/api/edition?${query.toString()}`);
	if (!response.ok) {
		throw new Error(`edition request failed with status ${response.status}`);
	}
	return EditionSchema.parse(await response.json());
}
