import { describe, expect, it } from "vitest";
import type { EditionDateRange } from "../src/dates/edition-date-range";
import {
	DEFAULT_ACTIVE_REGION_ID,
	editionSelectionSearch,
	readEditionSelection,
} from "../src/selection/edition-selection";

const RANGE: EditionDateRange = { minDate: "2026-01-15", maxDate: "2026-07-25" };

describe("readEditionSelection defaults", () => {
	it("defaults both params when the query string is empty", () => {
		expect(readEditionSelection("", RANGE)).toEqual({
			activeRegionId: DEFAULT_ACTIVE_REGION_ID,
			publicationDate: RANGE.maxDate,
		});
	});

	it("defaults only the missing param when one is present", () => {
		expect(readEditionSelection("?active_region_id=8", RANGE)).toEqual({
			activeRegionId: "8",
			publicationDate: RANGE.maxDate,
		});
	});
});

describe("readEditionSelection fallback", () => {
	it("falls back the region alone on a region outside the active list", () => {
		expect(
			readEditionSelection("?active_region_id=99&publication_date=2026-01-20", RANGE),
		).toEqual({
			activeRegionId: DEFAULT_ACTIVE_REGION_ID,
			publicationDate: "2026-01-20",
		});
	});

	it("falls back the date alone on a malformed date", () => {
		expect(
			readEditionSelection("?active_region_id=8&publication_date=not-a-date", RANGE),
		).toEqual({
			activeRegionId: "8",
			publicationDate: RANGE.maxDate,
		});
	});

	it("falls back a well-formed date that falls outside the servable range", () => {
		expect(
			readEditionSelection("?active_region_id=8&publication_date=2026-12-01", RANGE),
		).toEqual({
			activeRegionId: "8",
			publicationDate: RANGE.maxDate,
		});
	});
});

describe("editionSelectionSearch round-trip", () => {
	it("reads back the same selection it serialized", () => {
		const selection = { activeRegionId: "12", publicationDate: "2026-02-10" };

		expect(readEditionSelection(editionSelectionSearch(selection), RANGE)).toEqual(selection);
	});
});
