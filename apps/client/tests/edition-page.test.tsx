import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as editionApi from "../src/api/edition";
import { EditionPage } from "../src/pages/EditionPage";

vi.mock("../src/api/edition", () => ({
	getEdition: vi.fn(),
}));

function setUrl(search: string) {
	window.history.pushState(null, "", `/${search}`);
}

describe("EditionPage url-driven fetching", () => {
	beforeEach(() => {
		vi.mocked(editionApi.getEdition).mockReset();
		vi.mocked(editionApi.getEdition).mockResolvedValue({ status: "not-found" });
		setUrl("");
	});

	it("fetches the pair named in the url on mount", async () => {
		setUrl("?active_region_id=8&publication_date=2026-02-10");

		render(<EditionPage />);

		await waitFor(() =>
			expect(editionApi.getEdition).toHaveBeenCalledWith("8", "2026-02-10", expect.anything()),
		);
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
		await waitFor(() =>
			expect(editionApi.getEdition).toHaveBeenCalledWith("7", "2026-03-15", expect.anything()),
		);
	});
});
