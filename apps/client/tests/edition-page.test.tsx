import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as editionApi from "../src/api/edition";
import type { EditionGameReference, PublishedEdition } from "../src/api/edition";
import { EditionPage } from "../src/pages/EditionPage";

vi.mock("../src/api/edition", () => ({
	getEdition: vi.fn(),
}));

const BARE_COORDINATE_REFERENCE: EditionGameReference = {
	token: "[[GAME_REF_001]]",
	kind: "coord",
	northing: 3745,
	easting: 3857,
	display_text: "N 3745, E 3857",
	destination_url: "https://bitcraftmap.com/?center=3745,3857&zoom=3.0",
};

const LABELED_COORDINATE_REFERENCE: EditionGameReference = {
	token: "[[GAME_REF_002]]",
	kind: "coord",
	northing: 3745,
	easting: 3857,
	display_text: "Blacksmith Square",
	destination_url: "https://bitcraftmap.com/?center=3745,3857&zoom=3.0",
};

const ITEM_REFERENCE: EditionGameReference = {
	token: "[[GAME_REF_003]]",
	kind: "item",
	id: "163977632",
	display_text: "Ornate Leather Shirt",
	destination_url: "https://bitjita.com/items/163977632",
};

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

function publishedEditionWithReferences(gameReferences: readonly EditionGameReference[]): PublishedEdition {
	return {
		version: 3,
		active_region_id: "7",
		publication_date: "2026-08-25",
		title: "Region 7 Chronicle",
		announcements: [
			{
				title: "Market notice",
				summary: `Trade example: ${ITEM_REFERENCE.token}.`,
			},
		],
		main_story: {
			headline: "A headline",
			lede: "A lede.",
			body: `Scouts recorded ${BARE_COORDINATE_REFERENCE.token} before sunrise.`,
		},
		meta: {
			generated_at_utc: "2026-08-25T00:00:00.000Z",
			editorial_products: {
				main_story: { provider: "recorded", model: "recorded/main-story-write-v3" },
				announcements: { provider: "recorded", model: "recorded/announcements-write-v3" },
			},
			counts: { raw_count: 1, after_filter_count: 1, after_burst_count: 1, final_count: 1 },
		},
		game_references: [...gameReferences],
	};
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
		setUrl("?active_region_id=8&publication_date=2026-08-25");

		render(<EditionPage />);

		await waitFor(() => expect(editionApi.getEdition).toHaveBeenCalledTimes(1));
		const request = requestedEdition();
		expect(request.activeRegionId).toBe("8");
		expect(request.publicationDate).toBe("2026-08-25");
		expect(request.signal).toBeInstanceOf(AbortSignal);
	});

	it("restores and re-normalizes the fetched pair on popstate", async () => {
		setUrl("?active_region_id=8&publication_date=2026-08-25");
		render(<EditionPage />);
		await waitFor(() => expect(editionApi.getEdition).toHaveBeenCalledTimes(1));

		act(() => {
			setUrl("?active_region_id=99&publication_date=2026-08-25");
			window.dispatchEvent(new PopStateEvent("popstate"));
		});

		// active_region_id=99 is outside the active roster - popstate restores
		// the pair from the url and re-normalizes the invalid region back to
		// the default rather than requesting a region the page doesn't serve.
		await waitFor(() => expect(editionApi.getEdition).toHaveBeenCalledTimes(2));
		const request = requestedEdition(1);
		expect(request.activeRegionId).toBe("7");
		expect(request.publicationDate).toBe("2026-08-25");
		expect(request.signal).toBeInstanceOf(AbortSignal);
	});

	it("shows today's absent edition as waiting before the expected availability target", async () => {
		const alert = await renderAbsentEditionAt("2026-08-25T09:59:00.000Z", "2026-08-25");

		expect(alert.getAttribute("data-status")).toBe("info");
		expect(alert.textContent).toContain("expected by 10:00 AM UTC");
	});

	it("keeps today's absent edition waiting during the availability grace period", async () => {
		const alert = await renderAbsentEditionAt("2026-08-25T10:29:59.000Z", "2026-08-25");

		expect(alert.getAttribute("data-status")).toBe("info");
		expect(alert.textContent).toContain("expected by 10:00 AM UTC");
	});

	it("shows today's absent edition as a failure at the waiting cutoff", async () => {
		const alert = await renderAbsentEditionAt("2026-08-25T10:30:00.000Z", "2026-08-25");

		expect(alert.getAttribute("data-status")).toBe("error");
		expect(alert.textContent).toContain("No published edition for this region/date.");
	});

	it("shows a non-today absent edition as a failure before today's cutoff", async () => {
		const alert = await renderAbsentEditionAt("2026-08-26T10:00:00.000Z", "2026-08-25");

		expect(alert.getAttribute("data-status")).toBe("error");
	});

	it("regrades a waiting edition as a failure when the cutoff passes", async () => {
		const alert = await renderAbsentEditionAt("2026-08-25T10:29:59.000Z", "2026-08-25");
		expect(alert.getAttribute("data-status")).toBe("info");

		act(() => {
			vi.advanceTimersByTime(1_000);
		});

		expect(screen.getByRole("alert").getAttribute("data-status")).toBe("error");
	});

	it("passes retained game references through both newspaper sections", async () => {
		vi.mocked(editionApi.getEdition).mockResolvedValueOnce({
			outcome: "published",
			edition: publishedEditionWithReferences([
				BARE_COORDINATE_REFERENCE,
				LABELED_COORDINATE_REFERENCE,
				ITEM_REFERENCE,
			]),
		});

		render(<EditionPage />);

		await waitFor(() => {
			expect(screen.getByRole("link", { name: "N 3745, E 3857" })).toBeTruthy();
		});
		expect(screen.getByRole("link", { name: "N 3745, E 3857" }).getAttribute("href")).toBe(
			"https://bitcraftmap.com/?center=3745,3857&zoom=3.0",
		);
		expect(screen.getByRole("link", { name: "Ornate Leather Shirt" }).getAttribute("href")).toBe(
			"https://bitjita.com/items/163977632",
		);
	});

	it("keeps v2 token-like prose inert when the retained roster is empty", async () => {
		vi.mocked(editionApi.getEdition).mockResolvedValueOnce({
			outcome: "published",
			edition: publishedEditionWithReferences([]),
		});

		render(<EditionPage />);

		await waitFor(() => {
			expect(screen.getByText(/\[\[GAME_REF_001\]\]/)).toBeTruthy();
		});
		expect(screen.queryByRole("link", { name: "N 3745, E 3857" })).toBeNull();
		expect(screen.queryByRole("link", { name: "Blacksmith Square" })).toBeNull();
	});
});
