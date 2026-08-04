import { expect, test } from "vitest";
import { DateDerivationError, evidenceDateForPublicationDate } from "../src/evidence-date";

test("derives evidence date across month boundary", () => {
	expect(evidenceDateForPublicationDate("2026-03-01")).toBe("2026-02-28");
});

test("derives evidence date across year boundary", () => {
	expect(evidenceDateForPublicationDate("2026-01-01")).toBe("2025-12-31");
});

test("rejects rolled calendar date", () => {
	expect(() => evidenceDateForPublicationDate("2026-02-30")).toThrow(
		"Expected a UTC calendar date",
	);
});

test("rejects out-of-range derived date", () => {
	expect(() => evidenceDateForPublicationDate("1000-01-01")).toThrow(DateDerivationError);
});
