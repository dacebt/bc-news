import { PublicationDateSchema } from "@bc-news/contracts";

type DateDerivationErrorCode = "derived_date_out_of_range";

/**
 * Thrown when day-arithmetic on an already-valid calendar date produces a
 * result PublicationDateSchema rejects (e.g. a year past 9999, or before 1000).
 * Distinct from a rejection of the input itself, which throws directly from
 * PublicationDateSchema.parse and carries that schema's own error identity.
 */
export class DateDerivationError extends Error {
	readonly code: DateDerivationErrorCode;

	constructor(code: DateDerivationErrorCode, message: string) {
		super(message);
		this.name = "DateDerivationError";
		this.code = code;
	}
}

export function parseDateParts(dateStr: string): { year: number; month: number; day: number } {
	const parsed = PublicationDateSchema.parse(dateStr);
	return {
		year: Number(parsed.slice(0, 4)),
		month: Number(parsed.slice(5, 7)),
		day: Number(parsed.slice(8, 10)),
	};
}

function shiftDate(dateStr: string, dayOffset: number): { dateString: string; shiftedTs: number } {
	const { year, month, day } = parseDateParts(dateStr);
	const shiftedTs = Date.UTC(year, month - 1, day + dayOffset, 0, 0, 0, 0);
	const shiftedDate = new Date(shiftedTs);
	const shifted = [
		shiftedDate.getUTCFullYear().toString().padStart(4, "0"),
		(shiftedDate.getUTCMonth() + 1).toString().padStart(2, "0"),
		shiftedDate.getUTCDate().toString().padStart(2, "0"),
	].join("-");
	const result = PublicationDateSchema.safeParse(shifted);
	if (!result.success) {
		throw new DateDerivationError(
			"derived_date_out_of_range",
			`Derived date "${shifted}" from "${dateStr}" is outside the representable calendar range`,
		);
	}
	return { dateString: result.data, shiftedTs };
}

function utcDayWindow(dateStr: string, dayOffset: number): { startMs: number; endMs: number } {
	const { shiftedTs } = shiftDate(dateStr, dayOffset);
	return { startMs: shiftedTs, endMs: shiftedTs + 24 * 60 * 60 * 1000 };
}

/**
 * The date contract: an edition published on a given publication date sources
 * its evidence from the day before. This is the single expression of that
 * relationship; all date and window paths delegate to shiftDate so they cannot
 * drift apart by reimplementing the arithmetic separately.
 */
export function evidenceDateForPublicationDate(publicationDate: string): string {
	return shiftDate(publicationDate, -1).dateString;
}

/**
 * Millisecond window backing the same day-before contract, expressed in the
 * epoch-ms terms evidence timestamps arrive in. Delegates to the shared UTC-day
 * window calculation so its bounds cannot drift from the direct evidence-date
 * window path.
 */
export function evidenceWindowForPublicationDate(
	publicationDate: string,
): { startMs: number; endMs: number } {
	return utcDayWindow(publicationDate, -1);
}

/**
 * Millisecond window for an evidence date taken directly, rather than derived
 * from a publication date. Reuses shiftDate with a zero offset so the window
 * bounds share the exact same range-validation and epoch-ms arithmetic as
 * evidenceWindowForPublicationDate instead of a second hand-rolled path.
 */
export function evidenceWindowForEvidenceDate(
	evidenceDate: string,
): { startMs: number; endMs: number } {
	return utcDayWindow(evidenceDate, 0);
}
