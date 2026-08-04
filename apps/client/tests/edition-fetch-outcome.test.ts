import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Edition } from "@bc-news/contracts";
import { getEdition, type EditionFetchOutcome } from "../src/api/edition";

const ABORTED_OUTCOME = { outcome: "aborted" } satisfies EditionFetchOutcome;

function validEdition(): Edition {
	return {
		active_region_id: "7",
		publication_date: "2026-01-25",
		title: "Region 7 Chronicle",
		subtitle: "January 25, 2026",
		announcements: [],
		main_story: { headline: "A headline", lede: "A lede.", body: "A body." },
		meta: {
			generated_at_utc: "2026-01-25T00:00:00.000Z",
			editorial_capabilities: {
				main_story: { provider: "recorded", model: "recorded/main-story-v1" },
				announcements: { provider: "recorded", model: "recorded/announcements-v1" },
				packaging: { provider: "recorded", model: "recorded/packaging-v1" },
			},
			counts: { raw_count: 1, after_filter_count: 1, after_burst_count: 1, final_count: 1 },
		},
	};
}

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function request(signal = new AbortController().signal) {
	return getEdition({ activeRegionId: "7", publicationDate: "2026-01-25", signal });
}

beforeEach(() => {
	vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("getEdition outcome mapping", () => {
	it("reports published with the parsed edition on 200 valid json", async () => {
		const edition = validEdition();
		vi.mocked(fetch).mockResolvedValue(jsonResponse(200, edition));

		await expect(request()).resolves.toEqual({ outcome: "published", edition });
	});

	it("reports absent on 404", async () => {
		vi.mocked(fetch).mockResolvedValue(jsonResponse(404, { error: "edition_not_found" }));

		await expect(request()).resolves.toEqual({ outcome: "absent" });
	});

	it("reports invalid_request on 400", async () => {
		vi.mocked(fetch).mockResolvedValue(jsonResponse(400, { error: "invalid_edition_request" }));

		await expect(request()).resolves.toEqual({ outcome: "invalid_request" });
	});

	it("reports service_error with the http status on 500", async () => {
		vi.mocked(fetch).mockResolvedValue(jsonResponse(500, { error: "edition_unreadable" }));

		await expect(request()).resolves.toEqual({ outcome: "service_error", httpStatus: 500 });
	});

	it("reports misrouted_response on a 200 with html content-type", async () => {
		vi.mocked(fetch).mockResolvedValue(
			new Response("<!doctype html><html></html>", {
				status: 200,
				headers: { "content-type": "text/html" },
			}),
		);

		await expect(request()).resolves.toEqual({ outcome: "misrouted_response" });
	});

	it("reports misrouted_response on a 200 whose body does not parse as json", async () => {
		vi.mocked(fetch).mockResolvedValue(
			new Response("not actually json", {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);

		await expect(request()).resolves.toEqual({ outcome: "misrouted_response" });
	});

	it("reports invalid_response on json that fails the edition schema", async () => {
		vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { not: "an edition" }));

		await expect(request()).resolves.toEqual({ outcome: "invalid_response" });
	});

	it("reports network_error when fetch rejects", async () => {
		vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));

		await expect(request()).resolves.toEqual({ outcome: "network_error" });
	});

	it("reports aborted instead of throwing when fetch rejects with an abort", async () => {
		const abortError = new DOMException("The operation was aborted.", "AbortError");
		vi.mocked(fetch).mockRejectedValue(abortError);

		await expect(request()).resolves.toEqual(ABORTED_OUTCOME);
	});

	// isAbortError duck-types on `.name` rather than `instanceof DOMException`
	// so a realm mismatch (a signal aborted from a different window/worker
	// realm than this module's own DOMException) still resolves - a plain
	// object is never a DOMException instance, so this only passes if the
	// implementation never reaches for instanceof.
	it("reports aborted for a plain object shaped like an abort error", async () => {
		vi.mocked(fetch).mockRejectedValue({ name: "AbortError" });

		await expect(request()).resolves.toEqual(ABORTED_OUTCOME);
	});

	it("reports aborted when an aborted signal rejects fetch with a non-error reason", async () => {
		const controller = new AbortController();
		const reason = { source: "selection_changed" };
		controller.abort(reason);
		vi.mocked(fetch).mockRejectedValue(reason);

		await expect(request(controller.signal)).resolves.toEqual(ABORTED_OUTCOME);
	});

	it("reports aborted instead of throwing when reading the response body is aborted", async () => {
		const response = jsonResponse(200, validEdition());
		vi.spyOn(response, "json").mockRejectedValue(new DOMException("The operation was aborted.", "AbortError"));
		vi.mocked(fetch).mockResolvedValue(response);

		await expect(request()).resolves.toEqual(ABORTED_OUTCOME);
	});

	it("reports aborted when body reading fails after a non-error cancellation reason", async () => {
		const controller = new AbortController();
		const reason = { source: "selection_changed" };
		const response = jsonResponse(200, validEdition());
		vi.spyOn(response, "json").mockImplementation(() => {
			controller.abort(reason);
			return Promise.reject(new TypeError("body stream cancelled"));
		});
		vi.mocked(fetch).mockResolvedValue(response);

		await expect(request(controller.signal)).resolves.toEqual(ABORTED_OUTCOME);
	});
});
