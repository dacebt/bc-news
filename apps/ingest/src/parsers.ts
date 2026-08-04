export interface ParsedUsername {
	lang: string | null;
	username: string;
}

// A decimal integer and nothing else. parseInt is unusable at a boundary: it
// consumes a numeric prefix and discards the rest, so "7junk" becomes 7; without
// a radix it also reads "0x10" as 16; and even with radix 10 it reads "1e9" as 1.
// Anchoring the whole string is the only way to make the rejection total.
const DECIMAL_INTEGER = /^-?\d+$/;

/**
 * Parse a string that must be a decimal integer, or null if it is not one.
 * Values too large to survive as a JS number are rejected rather than silently
 * rounded — an identifier that does not round-trip is not the identifier sent.
 */
export function parseDecimalInteger(raw: string): number | null {
	if (!DECIMAL_INTEGER.test(raw)) {
		return null;
	}

	const parsed = Number(raw);
	return Number.isSafeInteger(parsed) ? parsed : null;
}

// The upper end of the ECMAScript time value range: beyond it, new Date(value)
// is an invalid date, so a value there cannot describe a real instant.
const MAX_TIME_VALUE = 8_640_000_000_000_000;

// The lower end is the Unix epoch, not the ECMAScript minimum (-MAX_TIME_VALUE).
// Callers subtract before formatting — `new Date(watermark - overlapMs)
// .toISOString()` in poller.ts — and a value sitting on the ECMAScript floor
// leaves the representable range under that subtraction, throwing a bare
// RangeError from inside a function whose whole job is to not throw. A
// boundary check only means something if a value it accepts survives the
// arithmetic its caller performs, so the accepted range is narrowed to leave
// room for it: 0 minus the widest configurable overlap (86_400s) is nowhere
// near the floor, and a chat timestamp before 1970 is not a real reading.
const MIN_TIME_VALUE = 0;

/**
 * Whether a value is a usable epoch-millisecond timestamp.
 *
 * Narrows `unknown` because a value read back from storage is external input:
 * a column declared INTEGER proves nothing about what comes out of it.
 * Measured against D1 — SQLite's INTEGER affinity converts text it can convert
 * losslessly ('1736539200000' reads back as the number, '1e3' as 1000) and
 * leaves the rest alone ('1.5' reads back as REAL 1.5, 'not-a-number' as
 * text), so only unconvertible text survives as a string.
 */
export function isEpochMilliseconds(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isInteger(value) &&
		value >= MIN_TIME_VALUE &&
		value <= MAX_TIME_VALUE
	);
}

/**
 * Parse a username that may carry a language prefix ("en/PlayerName") or not
 * ("PlayerName"). The raw string is retained by the caller regardless — this
 * only ever produces the split view of it.
 */
export function parseUsername(raw: string): ParsedUsername {
	const parts = raw.split("/");
	if (parts.length > 1) {
		return {
			lang: parts[0] || null,
			username: parts.slice(1).join("/"),
		};
	}
	return { lang: null, username: raw };
}

const CALENDAR_DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * Why `new Date` cannot be trusted with this string, or null when it can be.
 *
 * `new Date` already rejects most malformed fields — measured against V8,
 * month 00 and 13, day 00, hour 25, minute 60 and second 61 all yield an
 * invalid date — so those are left where they already fail rather than
 * re-implemented here. Two shapes it rolls instead of rejecting are not:
 *
 * 1. A day its month does not have. "2024-02-30" and "2023-02-29" both roll
 *    forward to March 1st, filing a message under a day it was not sent on.
 * 2. Anything that is not a basic-format calendar date. The expanded-year form
 *    "+002024-02-30T12:00:00Z" rolls to March 1st identically while skipping a
 *    check written against the basic form, and legacy shapes like
 *    "Feb 30 2024" roll *and* are read in the host's local timezone. Requiring
 *    the basic form removes that whole class instead of enumerating it, and
 *    costs nothing: BitJita emits timestamps that always match it.
 *
 * Hour 24 is not one of these. "2024-01-15T24:00:00Z" does advance to the
 * 16th, but ISO 8601 defines hour-24-at-exact-midnight as exactly that
 * instant, so it is a correct reading rather than an invented one —
 * "24:00:01" and "25:00:00" are both already invalid.
 *
 * A third shape is not a roll but a timezone hazard: per the ECMAScript
 * spec, a basic-format string carrying a time-of-day is read as local time
 * when it has no zone designator, while a date-only string is read as UTC.
 * BitJita's own serialization always carries a "+00" offset, but that offset
 * is stripped to "Z" upstream of this check, not asserted by it — a
 * timestamp one schema change away (a Postgres `timestamp without time
 * zone` column, say) would arrive with a time-of-day and no offset at all,
 * and this function would silently interpret it in the host's timezone
 * instead of UTC. `zoneDesignatorRejection` closes that: a time-of-day with
 * no "Z" or numeric offset is rejected rather than guessed at.
 */
function calendarDateRejection(normalized: string): string | null {
	const parts = CALENDAR_DATE_PREFIX.exec(normalized);
	if (!parts) {
		return "does not begin with a YYYY-MM-DD calendar date";
	}

	const year = Number(parts[1]);
	const month = Number(parts[2]);
	const day = Number(parts[3]);
	if (month < 1 || month > 12) {
		return null;
	}

	const isLeapYear = year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
	const daysInMonth =
		month === 2
			? isLeapYear
				? 29
				: 28
			: month === 4 || month === 6 || month === 9 || month === 11
				? 30
				: 31;
	return day > daysInMonth ? "names a day its month does not have" : null;
}

const TIME_OF_DAY = /T\d{2}:\d{2}:\d{2}/;
const ZONE_DESIGNATOR = /(Z|[+-]\d{2}:?\d{2})$/;

/**
 * Reject a basic-format string that carries a time-of-day but no "Z" or
 * numeric offset. Per the ECMAScript Date Time String Format, such a string
 * is read in the host's local timezone rather than UTC — see the third
 * shape documented on `calendarDateRejection`. A date-only string has no
 * time-of-day to be ambiguous about and is left alone; ECMAScript already
 * reads that form as UTC.
 */
function zoneDesignatorRejection(normalized: string): string | null {
	if (TIME_OF_DAY.test(normalized) && !ZONE_DESIGNATOR.test(normalized)) {
		return "carries a time-of-day with no UTC offset or Z designator";
	}
	return null;
}

/**
 * Parse a BitJita timestamp string to epoch milliseconds, or null when it is
 * not a usable one. Accepts basic-form ISO-8601 ("2024-01-10T12:34:56Z" or
 * "...+00:00") and the observed space-separated form ("2024-01-10
 * 12:34:56+00").
 */
export function parseBitJitaTimestamp(raw: string): number | null {
	let normalized = raw.trim();
	// Normalize the observed "YYYY-MM-DD HH:MM:SS+00" shape into ISO-8601.
	normalized = normalized.replace(/^(\d{4}-\d{2}-\d{2})\s+/, "$1T");
	normalized = normalized.replace(/\+00(:00)?$/, "Z");

	if (calendarDateRejection(normalized) !== null || zoneDesignatorRejection(normalized) !== null) {
		return null;
	}

	const date = new Date(normalized);
	if (Number.isNaN(date.getTime())) {
		return null;
	}

	// A parsed timestamp is a produced value like any other, so it is held to
	// the same range as one read back from storage — this is what a message
	// dated before 1970 is caught by. Both producers agreeing on one range is
	// what makes the poller's `watermark - overlapMs` safe by construction
	// rather than by luck about which years a given input shape happens to
	// allow.
	const timestampTs = date.getTime();
	return isEpochMilliseconds(timestampTs) ? timestampTs : null;
}
