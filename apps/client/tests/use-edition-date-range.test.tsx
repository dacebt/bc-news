import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditionDateRange } from "../src/dates/use-edition-date-range";

describe("useEditionDateRange midnight rollover", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(Date.UTC(2026, 7, 25, 23, 59, 0)));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("advances the maxDate bound across utc midnight", () => {
		const { result } = renderHook(() => useEditionDateRange());
		expect(result.current.maxDate).toBe("2026-08-25");

		act(() => {
			vi.advanceTimersByTime(2 * 60 * 1000);
		});

		expect(result.current.maxDate).toBe("2026-08-26");
	});

	it("leaves the minDate bound fixed across the rollover", () => {
		const { result } = renderHook(() => useEditionDateRange());
		const minBefore = result.current.minDate;

		act(() => {
			vi.advanceTimersByTime(2 * 60 * 1000);
		});

		expect(result.current.minDate).toBe(minBefore);
	});
});
