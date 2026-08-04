import { z } from "zod";

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Date.UTC's 0-99 two-digit-year remapping window would be closed by a floor of
// 100 alone. The floor is set higher, at 1000, so every accepted year -- and every
// year a derivation (e.g. +/-1 day across a year boundary) produces from one -- is
// guaranteed to render as exactly four digits, which is what keeps derivation from
// ever emitting a 3-digit year string.
const MIN_CALENDAR_YEAR = 1000;

function isCalendarDate(value: string): boolean {
	if (!CALENDAR_DATE.test(value)) return false;
	const year = Number(value.slice(0, 4));
	const month = Number(value.slice(5, 7));
	const day = Number(value.slice(8, 10));
	if (year < MIN_CALENDAR_YEAR || month < 1 || month > 12 || day < 1) return false;

	const isLeapYear = year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
	const daysInMonth = month === 2
		? (isLeapYear ? 29 : 28)
		: (month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31);
	return day <= daysInMonth;
}

export const PublicationDateSchema = z.string().refine(
	isCalendarDate,
	"Expected a UTC calendar date (YYYY-MM-DD)",
);

export type PublicationDate = z.infer<typeof PublicationDateSchema>;
