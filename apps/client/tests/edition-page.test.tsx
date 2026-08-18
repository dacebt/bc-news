import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as editionApi from "../src/api/edition";
import { EditionPage } from "../src/pages/EditionPage";

vi.mock("../src/api/edition", () => ({
	getEdition: vi.fn(),
}));

function setUrl(search: string) {
	window.history.pushState(null, "", `/${search}`);
}

function requestedEdition(callIndex = 0) {
	const request = vi.mocked(editionApi.getEdition).mock.calls[callIndex]?.[0];
	if (!request) {
		throw new Error(`getEdition call ${callIndex} was not recorded`);
	}
	return request;
}

async function renderAbsentEditionAt(instant: string, publicationDate: string) {
	vi.useFakeTimers();
	vi.setSystemTime(new Date(instant));
	setUrl(`?active_region_id=7&publication_date=${publicationDate}`);

	await act(async () => {
		render(<EditionPage />);
		await Promise.resolve();
	});

	return screen.getByRole("alert");
}

describe("EditionPage url-driven fetching", () => {
	beforeEach(() => {
		vi.mocked(editionApi.getEdition).mockReset();
		vi.mocked(editionApi.getEdition).mockResolvedValue({ outcome: "absent" });
		setUrl("");
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("fetches the pair named in the url on mount", async () => {
		setUrl("?active_region_id=8&publication_date=2026-02-10");

		render(<EditionPage />);

		await waitFor(() => expect(editionApi.getEdition).toHaveBeenCalledTimes(1));
		const request = requestedEdition();
		expect(request.activeRegionId).toBe("8");
		expect(request.publicationDate).toBe("2026-02-10");
		expect(request.signal).toBeInstanceOf(AbortSignal);
	});

	it("restores and re-normalizes the fetched pair on popstate", async () => {
		setUrl("?active_region_id=8&publication_date=2026-02-10");
		render(<EditionPage />);
		await waitFor(() => expect(editionApi.getEdition).toHaveBeenCalledTimes(1));

		act(() => {
			setUrl("?active_region_id=99&publication_date=2026-03-15");
			window.dispatchEvent(new PopStateEvent("popstate"));
		});

		// active_region_id=99 is outside the active roster - popstate restores
		// the pair from the url and re-normalizes the invalid region back to
		// the default rather than requesting a region the page doesn't serve.
		await waitFor(() => expect(editionApi.getEdition).toHaveBeenCalledTimes(2));
		const request = requestedEdition(1);
		expect(request.activeRegionId).toBe("7");
		expect(request.publicationDate).toBe("2026-03-15");
		expect(request.signal).toBeInstanceOf(AbortSignal);
	});

	it("shows today's absent edition as waiting before the expected availability target", async () => {
		const alert = await renderAbsentEditionAt("2026-03-15T09:59:00.000Z", "2026-03-15");

		expect(alert.getAttribute("data-status")).toBe("info");
		expect(alert.textContent).toContain("expected by 10:00 AM UTC");
	});

	it("keeps today's absent edition waiting during the availability grace period", async () => {
		const alert = await renderAbsentEditionAt("2026-03-15T10:29:59.000Z", "2026-03-15");

		expect(alert.getAttribute("data-status")).toBe("info");
		expect(alert.textContent).toContain("expected by 10:00 AM UTC");
	});

	it("shows today's absent edition as a failure at the waiting cutoff", async () => {
		const alert = await renderAbsentEditionAt("2026-03-15T10:30:00.000Z", "2026-03-15");

		expect(alert.getAttribute("data-status")).toBe("error");
		expect(alert.textContent).toContain("No published edition for this region/date.");
	});

	it("shows a non-today absent edition as a failure before today's cutoff", async () => {
		const alert = await renderAbsentEditionAt("2026-03-15T10:00:00.000Z", "2026-03-14");

		expect(alert.getAttribute("data-status")).toBe("error");
	});

	it("regrades a waiting edition as a failure when the cutoff passes", async () => {
		const alert = await renderAbsentEditionAt("2026-03-15T10:29:59.000Z", "2026-03-15");
		expect(alert.getAttribute("data-status")).toBe("info");

		act(() => {
			vi.advanceTimersByTime(1_000);
		});

		expect(screen.getByRole("alert").getAttribute("data-status")).toBe("error");
	});
});
