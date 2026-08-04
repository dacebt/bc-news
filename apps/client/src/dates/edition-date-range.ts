import { PublicationDateSchema } from "@bc-news/contracts";

// The one range every date-change path on the newspaper answers to. Ported
// from the v1 monorepo's unshipped fix (bc-news-worker apps/newspaper
// src/dates/editionDateRange.ts), with the bound read off UTC rather than
// the local clock -- the deployed v0.1.4 bug this rebuild does not carry
// forward.

export interface EditionDateRange {
	minDate: string;
	maxDate: string;
}

// Earliest published edition -- the v1 MIN_DATE concept. Named so call sites
// never carry the date as a magic string.
export const EARLIEST_PUBLICATION_DATE = "2026-01-15";

const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function utcCalendarDate(instant: Date): string {
	const year = instant.getUTCFullYear();
	const month = String(instant.getUTCMonth() + 1).padStart(2, "0");
	const day = String(instant.getUTCDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

// The upper bound, never below the lower one. A clock reading earlier than
// the deployment date would otherwise describe a range holding no dates at
// all: the input carries a `max` before its `min` and so accepts no value,
// both arrows are disabled, and the date the page opened on is one it
// refuses to request -- a dead end with nowhere for the reader to go.
// Clamping keeps the range non-empty, so the opening date is always one the
// page will ask for and report an answer on.
export function maxServableDate(instant: Date): string {
	const today = utcCalendarDate(instant);
	return today < EARLIEST_PUBLICATION_DATE ? EARLIEST_PUBLICATION_DATE : today;
}

// Total over anything the date input can hold, including the empty string a
// cleared field produces -- an unparseable value is simply not a date this
// page serves. Validated through PublicationDateSchema rather than the shape
// regex alone: the regex accepts a calendar-roll value like '2026-02-30',
// and the schema's day-of-month check is what rejects it. The bounds below
// are string comparisons, and a truncated value like '2026-05' sorts between
// them and would otherwise read as servable, so the schema check runs first.
export function isServableDate(date: string, range: EditionDateRange): boolean {
	if (!PublicationDateSchema.safeParse(date).success) {
		return false;
	}
	return date >= range.minDate && date <= range.maxDate;
}

// Steps `days` from `date`, and answers with the result only if it is still
// a date the page serves. `null` is the "there is no such day to go to"
// answer that both arrow buttons render as a disabled control.
//
// The arithmetic stays entirely in UTC -- Date.UTC in, toISOString out --
// rather than a getDate/setDate pair, which parses a YYYY-MM-DD string as
// UTC midnight and then reads it back through local getters. That mix lands
// on the wrong day across a local DST boundary.
export function stepWithinRange(date: string, days: number, range: EditionDateRange): string | null {
	if (!CALENDAR_DATE_PATTERN.test(date)) {
		return null;
	}
	const [year, month, day] = date.split("-").map(Number) as [number, number, number];
	const stepped = new Date(Date.UTC(year, month - 1, day + days));
	const steppedDate = stepped.toISOString().split("T")[0] as string;
	return isServableDate(steppedDate, range) ? steppedDate : null;
}
