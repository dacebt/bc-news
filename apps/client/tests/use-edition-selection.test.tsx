import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditionDateRange } from "../src/dates/edition-date-range";
import { DEFAULT_ACTIVE_REGION_ID } from "../src/selection/edition-selection";
import { useEditionSelection } from "../src/selection/use-edition-selection";

const RANGE: EditionDateRange = { minDate: "2026-01-15", maxDate: "2026-07-25" };

function setUrl(search: string) {
	window.history.pushState(null, "", `/${search}`);
}

describe("useEditionSelection", () => {
	afterEach(() => {
		setUrl("");
	});

	it("reads the initial pair from the url", () => {
		setUrl("?active_region_id=8&publication_date=2026-02-10");

		const { result } = renderHook(() => useEditionSelection(RANGE));

		expect(result.current.selection).toEqual({ activeRegionId: "8", publicationDate: "2026-02-10" });
	});

	it("pushes a history entry when the selection changes", () => {
		setUrl("");
		const pushSpy = vi.spyOn(window.history, "pushState");
		const { result } = renderHook(() => useEditionSelection(RANGE));

		act(() => {
			result.current.setSelection({ activeRegionId: "12", publicationDate: "2026-03-01" });
		});

		expect(pushSpy).toHaveBeenCalledWith(null, "", "?active_region_id=12&publication_date=2026-03-01");
		pushSpy.mockRestore();
	});

	it("restores and re-normalizes the selection on popstate", () => {
		setUrl("?active_region_id=8&publication_date=2026-02-10");
		const { result } = renderHook(() => useEditionSelection(RANGE));

		act(() => {
			setUrl("?active_region_id=99&publication_date=2026-04-05");
			window.dispatchEvent(new PopStateEvent("popstate"));
		});

		expect(result.current.selection).toEqual({
			activeRegionId: DEFAULT_ACTIVE_REGION_ID,
			publicationDate: "2026-04-05",
		});
	});
});
