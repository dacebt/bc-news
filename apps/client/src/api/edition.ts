import { EditionSchema, type Edition } from "@bc-news/contracts";

// Typed, exhaustive outcomes for a single edition fetch. The caller
// distinguishes each case by `status` rather than by parsing a thrown
// error's message string. `network-error` covers both a genuine network
// failure and a CORS rejection - the Fetch API reports both as the same
// opaque rejected promise with no further detail, so this type does not
// claim a distinction the browser doesn't give us.
export type EditionFetchOutcome =
	| { status: "success"; edition: Edition }
	| { status: "not-found" }
	| { status: "invalid-request" }
	| { status: "service-error"; httpStatus: number }
	| { status: "network-error" }
	| { status: "misrouted-response" }
	| { status: "invalid-response" };

// No `instanceof` check is trustworthy here: the rejection value isn't
// guaranteed to be any particular class (`controller.abort(reason)` rejects
// with `reason` verbatim, so an abort can surface as a string or a plain
// object with no prototype worth testing), and a realm mismatch between
// this module's `Error`/`DOMException` and a host's can fail an `instanceof`
// check even when the prototype chain is correct. Duck-typing on `.name` is
// independent of both, and shared by every catch below so an abort is
// reported identically regardless of which phase of the request it lands in.
function isAbortError(err: unknown): boolean {
	return typeof err === "object" && err !== null && "name" in err && err.name === "AbortError";
}

export async function getEdition(
	activeRegionId: string,
	publicationDate: string,
	options?: { signal?: AbortSignal },
): Promise<EditionFetchOutcome> {
	const query = new URLSearchParams({
		active_region_id: activeRegionId,
		publication_date: publicationDate,
	});

	let response: Response;
	try {
		response = await fetch(`/api/edition?${query.toString()}`, {
			cache: "no-store",
			...(options?.signal ? { signal: options.signal } : {}),
		});
	} catch (err) {
		// Abort is caller-driven cancellation, not a fetch outcome to report -
		// rethrow so the caller's existing abort handling still owns it instead
		// of it surfacing as a modeled failure state.
		if (isAbortError(err)) {
			throw err;
		}
		console.error("getEdition: network request failed", err);
		return { status: "network-error" };
	}

	if (!response.ok) {
		if (response.status === 404) {
			return { status: "not-found" };
		}
		// A 400 is the request's own params failing the service's validation,
		// not the service misbehaving - kept distinct so the alert never blames
		// the service for a param the client itself sent malformed.
		if (response.status === 400) {
			return { status: "invalid-request" };
		}
		return { status: "service-error", httpStatus: response.status };
	}

	// A 2xx whose Content-Type isn't JSON means the request never reached the
	// generation Worker's API at all - it landed on something else answering
	// for that origin (a dev server's or Cloudflare's static-asset fallback,
	// most commonly triggered by a misrouted path). That is a client
	// configuration/routing problem, not the service returning bad data, so
	// it gets its own outcome rather than collapsing into invalid-response.
	const contentType = response.headers.get("content-type") ?? "";
	if (!contentType.includes("json")) {
		console.error("getEdition: response content-type was not JSON", contentType);
		return { status: "misrouted-response" };
	}

	let body: unknown;
	try {
		body = await response.json();
	} catch (err) {
		// The body stream errors if the request is aborted while it's still
		// being read - that is caller-driven cancellation, same as the fetch()
		// catch above, not a fetch outcome to report.
		if (isAbortError(err)) {
			throw err;
		}
		// Claimed JSON that doesn't parse as JSON is the same misrouting symptom
		// as a non-JSON content-type - some intermediary is answering instead of
		// the generation Worker - so it's reported the same way rather than as
		// invalid-response, which is reserved for a body the service itself
		// produced.
		console.error("getEdition: response body was not valid JSON", err);
		return { status: "misrouted-response" };
	}

	const parsed = EditionSchema.safeParse(body);
	if (!parsed.success) {
		console.error("getEdition: response failed EditionSchema validation", parsed.error.issues);
		return { status: "invalid-response" };
	}

	return { status: "success", edition: parsed.data };
}
