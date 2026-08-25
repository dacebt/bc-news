import { describe, expect, it } from "vitest";
import {
	EARLIEST_PUBLICATION_DATE,
	isServableDate,
	maxServableDate,
	stepWithinRange,
	type EditionDateRange,
} from "../src/dates/edition-date-range";

const RANGE: EditionDateRange = { minDate: EARLIEST_PUBLICATION_DATE, maxDate: "2026-09-25" };
// Wide enough that the stepping cases below are never answered by the
// bounds, so what they observe is the arithmetic and nothing else.
const WIDE: EditionDateRange = { minDate: "2025-01-01", maxDate: "2026-12-31" };

describe("maxServableDate", () => {
	// The suite is pinned to America/New_York (UTC-4 in August), so 22:00 local
	// is already the next UTC day. A local-clock read would answer the day
	// before.
	it("returns the utc date when local date differs", () => {
		expect(maxServableDate(new Date(Date.UTC(2026, 7, 26, 2, 0, 0)))).toBe("2026-08-26");
	});

	it("clamps to the earliest publication date", () => {
		expect(maxServableDate(new Date(Date.UTC(2026, 0, 5, 12, 0, 0)))).toBe(EARLIEST_PUBLICATION_DATE);
	});
});

describe("stepWithinRange calendar arithmetic", () => {
	it("steps forward across a month boundary", () => {
		expect(stepWithinRange("2026-01-31", 1, WIDE)).toBe("2026-02-01");
	});

	it("steps back across a year boundary", () => {
		expect(stepWithinRange("2026-01-01", -1, WIDE)).toBe("2025-12-31");
	});
});

describe("stepWithinRange bounds", () => {
	it("answers null stepping past the latest served date", () => {
		expect(stepWithinRange("2026-09-25", 1, RANGE)).toBeNull();
	});

	it("answers null stepping past the earliest served date", () => {
		expect(stepWithinRange(EARLIEST_PUBLICATION_DATE, -1, RANGE)).toBeNull();
	});

	it("answers null for a malformed value", () => {
		expect(stepWithinRange("not-a-date", 1, RANGE)).toBeNull();
	});

	it("answers null for an empty value", () => {
		expect(stepWithinRange("", 1, RANGE)).toBeNull();
	});
});

describe("isServableDate", () => {
	it("accepts the bounds themselves", () => {
		expect(isServableDate(EARLIEST_PUBLICATION_DATE, RANGE)).toBe(true);
		expect(isServableDate("2026-09-25", RANGE)).toBe(true);
	});

	it("rejects the day before the earliest served date", () => {
		expect(isServableDate("2026-08-24", RANGE)).toBe(false);
	});

	it("rejects the day after the latest served date", () => {
		expect(isServableDate("2026-09-26", RANGE)).toBe(false);
	});

	it("rejects a cleared field", () => {
		expect(isServableDate("", RANGE)).toBe(false);
	});

	// The bounds alone would accept this: '2026-08-25' < '2026-09' <
	// '2026-09-25' as strings. Only the shape check refuses it.
	it("rejects a truncated date that sorts between the bounds", () => {
		expect(isServableDate("2026-09", RANGE)).toBe(false);
	});

	it("rejects a value that is not a date at all", () => {
		expect(isServableDate("yesterday", RANGE)).toBe(false);
	});
});
