import { evidenceDateForPublicationDate } from "@bc-news/generation-core";

export function publicationDateForEvidenceDate(
	evidenceDate: string,
	fail: (code: string, path: string, message: string) => never,
): string {
	const [year, month, day] = evidenceDate.split("-").map(Number);
	const shifted = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + 1));
	const candidate = `${String(shifted.getUTCFullYear()).padStart(4, "0")}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
	if (evidenceDateForPublicationDate(candidate) !== evidenceDate) fail("identity_mismatch", evidenceDate, "Evidence date does not round-trip to a publication date");
	return candidate;
}

export function verifyFixtureRoster<TEntry extends { ordinal: number; id: string }>(
	entries: readonly TEntry[],
	path: string,
	unique: (values: readonly string[], path: string, subject: string) => void,
	fail: (code: string, path: string, message: string) => never,
): void {
	unique(entries.map(({ id }) => id), path, "fixture ids");
	for (const [index, entry] of entries.entries()) if (entry.ordinal !== index + 1) fail("invalid_order", path, "Fixture ordinals must match manifest positions");
}

export function closedRoster(
	expectedPaths: readonly string[],
	actualPaths: readonly string[],
	path: string,
	message: string,
	fail: (code: string, path: string, message: string) => never,
): void {
	const expected = [...expectedPaths].sort();
	const actual = [...actualPaths].sort();
	if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) fail("directory_not_closed", path, message);
}
