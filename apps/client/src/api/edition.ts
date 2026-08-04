import { EditionSchema, type Edition } from "@bc-news/contracts";

// Typed, exhaustive outcomes for a single edition fetch. The caller
// distinguishes each case by `outcome` rather than by parsing a thrown
// error's message string, and getEdition never throws for any of these -
// including a caller-driven abort, which is a modeled `aborted` case rather
// than a rejected promise. `network_error` covers both a genuine network
// failure and a CORS rejection - the Fetch API reports both as the same
// opaque rejected promise with no further detail, so this type does not
// claim a distinction the browser doesn't give us.
//
// `invalid_request` and `service_error` are carried over from the prior
// draft beyond the frozen seam's case list - the generation Worker's own
// route (apps/generation/src/routes.ts) genuinely distinguishes a 400
// (the client's own params failing validation) from a 5xx (the service
// itself failing), and collapsing either into `misrouted_response` or
// `network_error` would blame the wrong side for the failure. Reported as a
// deviation in the hand report rather than dropped silently.
export type EditionFetchOutcome =
	| { outcome: "published"; edition: Edition }
	| { outcome: "absent" }
	| { outcome: "invalid_request" }
	| { outcome: "service_error"; httpStatus: number }
	| { outcome: "network_error" }
	| { outcome: "misrouted_response" }
	| { outcome: "invalid_response" }
	| { outcome: "aborted" };

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

export async function getEdition({
	activeRegionId,
	publicationDate,
	signal,
}: {
	activeRegionId: string;
	publicationDate: string;
	signal: AbortSignal;
}): Promise<EditionFetchOutcome> {
	const query = new URLSearchParams({
		active_region_id: activeRegionId,
		publication_date: publicationDate,
	});

	let response: Response;
	try {
		response = await fetch(`/api/edition?${query.toString()}`, { cache: "no-store", signal });
	} catch (err) {
		// Abort is caller-driven cancellation, not a failure the fetch itself
		// experienced - modeled as its own outcome so the caller never needs a
		// try/catch to keep a cancelled selection from surfacing as an error.
		if (signal.aborted || isAbortError(err)) {
			return { outcome: "aborted" };
		}
		console.error("getEdition: network request failed", err);
		return { outcome: "network_error" };
	}

	if (!response.ok) {
		if (response.status === 404) {
			return { outcome: "absent" };
		}
		// A 400 is the request's own params failing the service's validation,
		// not the service misbehaving - kept distinct so the alert never blames
		// the service for a param the client itself sent malformed.
		if (response.status === 400) {
			return { outcome: "invalid_request" };
		}
		return { outcome: "service_error", httpStatus: response.status };
	}

	// A 2xx whose Content-Type isn't JSON means the request never reached the
	// generation Worker's API at all - it landed on something else answering
	// for that origin (a dev server's or Cloudflare's static-asset fallback,
	// most commonly triggered by a misrouted path). That is a client
	// configuration/routing problem, not the service returning bad data, so
	// it gets its own outcome rather than collapsing into invalid_response.
	const contentType = response.headers.get("content-type") ?? "";
	if (!contentType.includes("json")) {
		console.error("getEdition: response content-type was not JSON", contentType);
		return { outcome: "misrouted_response" };
	}

	let body: unknown;
	try {
		body = await response.json();
	} catch (err) {
		// The body stream errors if the request is aborted while it's still
		// being read - the same caller-driven cancellation as the fetch()
		// catch above, modeled the same way.
		if (signal.aborted || isAbortError(err)) {
			return { outcome: "aborted" };
		}
		// Claimed JSON that doesn't parse as JSON is the same misrouting symptom
		// as a non-JSON content-type - some intermediary is answering instead of
		// the generation Worker - so it's reported the same way rather than as
		// invalid_response, which is reserved for a body the service itself
		// produced.
		console.error("getEdition: response body was not valid JSON", err);
		return { outcome: "misrouted_response" };
	}

	const parsed = EditionSchema.safeParse(body);
	if (!parsed.success) {
		console.error("getEdition: response failed EditionSchema validation", parsed.error.issues);
		return { outcome: "invalid_response" };
	}

	return { outcome: "published", edition: parsed.data };
}
