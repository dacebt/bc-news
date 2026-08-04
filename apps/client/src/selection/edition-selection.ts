import { ACTIVE_REGION_IDS, PublicationDateSchema } from "@bc-news/contracts";
import { isServableDate, type EditionDateRange } from "../dates/edition-date-range";

export interface EditionSelection {
	activeRegionId: string;
	publicationDate: string;
}

// v0.1.4's default region -- kept as the fallback so an absent or invalid
// `active_region_id` still lands on the pair readers have always opened on.
export const DEFAULT_ACTIVE_REGION_ID = "7";

// Reads the (active region, publication date) pair out of a URL's search
// string. Each param falls back independently rather than the pair failing
// together: a reader who mistypes only the date should not also lose a
// valid region. A well-formed but out-of-range date (e.g. from a stale
// bookmark) falls back the same way a malformed one does -- both describe a
// date this page will not serve.
export function readEditionSelection(search: string, range: EditionDateRange): EditionSelection {
	const query = new URLSearchParams(search);

	const region = query.get("active_region_id");
	const activeRegionId = region !== null && ACTIVE_REGION_IDS.includes(region)
		? region
		: DEFAULT_ACTIVE_REGION_ID;

	const date = query.get("publication_date");
	const parsedDate = date === null ? undefined : PublicationDateSchema.safeParse(date);
	const publicationDate = parsedDate?.success === true && isServableDate(parsedDate.data, range)
		? parsedDate.data
		: range.maxDate;

	return { activeRegionId, publicationDate };
}

export function editionSelectionSearch(selection: EditionSelection): string {
	const query = new URLSearchParams({
		active_region_id: selection.activeRegionId,
		publication_date: selection.publicationDate,
	});
	return `?${query.toString()}`;
}
