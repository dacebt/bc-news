import { readFileSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface BitJitaFixtureMessage {
	entityId: string;
	username: string;
	timestamp: string;
	regionId: string;
	channelId: string;
	text: string;
}

interface BitJitaFixture {
	messages: BitJitaFixtureMessage[];
	total: number;
}

type BitJitaEntityKind = "item" | "cargo" | "claim" | "coll" | "res";

interface BitJitaResolutionEntry {
	kind: BitJitaEntityKind;
	id: string;
	name: string;
}

// Exported so every walk module that needs the fixture corpus (this server
// and the ingest-poll phase's own expected-row-count check) resolves the
// same path — a fixture rename now only requires one edit.
export const fixturePath = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"packages",
	"fixtures",
	"bitjita",
	"active-region-7_2026-08-24.json",
);

const resolutionPath = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"packages",
	"fixtures",
	"bitjita",
	"game-reference-resolutions.json",
);

export interface BitJitaStubServer {
	baseUrl: string;
	close: () => Promise<void>;
}

function respondJson(res: ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify(body));
}

function parseResolutionEntries(candidate: unknown): readonly BitJitaResolutionEntry[] {
	if (!Array.isArray(candidate)) {
		throw new Error("bitjita resolution fixture must be an array");
	}
	return candidate.map((entry, index) => {
		if (
			typeof entry !== "object" ||
			entry === null ||
			!["item", "cargo", "claim", "coll", "res"].includes(String((entry as { kind?: unknown }).kind)) ||
			typeof (entry as { id?: unknown }).id !== "string" ||
			typeof (entry as { name?: unknown }).name !== "string"
		) {
			throw new Error(`bitjita resolution fixture entry ${String(index + 1)} is invalid`);
		}
		return entry as BitJitaResolutionEntry;
	});
}

const ENTITY_ROUTE_BY_KIND: Record<
	BitJitaEntityKind,
	{
		readonly apiPath: string;
		readonly envelopeKey: "item" | "cargo" | "claim" | "collectible" | "resource";
		readonly idField: "id" | "entityId";
	}
> = {
	item: { apiPath: "/api/items", envelopeKey: "item", idField: "id" },
	cargo: { apiPath: "/api/cargo", envelopeKey: "cargo", idField: "id" },
	claim: { apiPath: "/api/claims", envelopeKey: "claim", idField: "entityId" },
	coll: { apiPath: "/api/collectibles", envelopeKey: "collectible", idField: "id" },
	res: { apiPath: "/api/resources", envelopeKey: "resource", idField: "id" },
};

function headerValue(value: string | string[] | undefined): string | null {
	if (Array.isArray(value)) {
		return value[0] ?? null;
	}
	return value ?? null;
}

function entityHeaderViolation(headers: Readonly<Record<string, string | string[] | undefined>>): string | null {
	const appIdentifier = headerValue(headers["x-app-identifier"]);
	if (appIdentifier !== "bc-news") {
		return `expected x-app-identifier bc-news, got ${JSON.stringify(appIdentifier)}`;
	}
	const userAgent = headerValue(headers["user-agent"]);
	if (userAgent !== "bc-news") {
		return `expected User-Agent bc-news, got ${JSON.stringify(userAgent)}`;
	}
	return null;
}

function matchedEntityIdentity(pathname: string): { kind: BitJitaEntityKind; id: string } | null {
	for (const kind of Object.keys(ENTITY_ROUTE_BY_KIND) as BitJitaEntityKind[]) {
		const prefix = `${ENTITY_ROUTE_BY_KIND[kind].apiPath}/`;
		if (!pathname.startsWith(prefix)) {
			continue;
		}
		const id = pathname.slice(prefix.length);
		if (id.length === 0 || id.includes("/")) {
			return null;
		}
		return { kind, id };
	}
	return null;
}

function entityResponseBody(
	entry: BitJitaResolutionEntry,
): Record<string, { id?: string; entityId?: string; name: string }> {
	const route = ENTITY_ROUTE_BY_KIND[entry.kind];
	return {
		[route.envelopeKey]: {
			[route.idField]: entry.id,
			name: entry.name,
		},
	};
}

// BitJita's own observed ceiling, not this stub's policy: limit=200 against
// the live API returns HTTP 200 {"error": "Limit is too high"}, limit=100
// succeeds. apps/ingest/src/config.ts bounds POLL_LIMIT to the same value.
const MAX_LIMIT = 100;

// How many additional fixture rows become visible on each accepted /api/chat
// call — the stand-in for a corpus that grows between polls. Deliberately
// smaller than MAX_LIMIT so a freshly-revealed batch alone stays under the
// poll limit: the walk's ingest-poll phase proves draining a backlog deeper
// than one page across several polls, not the poller's gap/stuck handling
// for a page that is itself oversized (that is poller.test.ts's job, run
// against a mocked BitJita rather than this stub). REVEAL_BATCH_SIZE alone
// does not bound what a single page can contain, though: `eligible` below
// also carries whatever previously-revealed rows POLL_OVERLAP_SECONDS pulls
// back into the `since` window, and that count is the poller's to choose,
// not this server's. Capping the returned page (see `pageLimit` below) is
// what actually keeps every page under the poll limit for every legal
// overlap.
const REVEAL_BATCH_SIZE = 90;

/**
 * A minimal stand-in for BitJita's GET /api/chat, pinned to the contract
 * observed against the live API rather than an assumed one: `since` is
 * honored (rows strictly before it are excluded), but a page is always the
 * *newest* `limit` eligible rows, never an oldest-first prefix — so a
 * backlog deeper than `limit` has a middle no `since` value can reach. The
 * response body itself stays ascending; only which slice of it is chosen
 * changes. `since` is compared against each fixture timestamp string
 * lexicographically rather than parsed as a date: every fixture timestamp is
 * fixed-offset, millisecond-precision ISO-8601 UTC, which already sorts
 * identically to chronological order, and the walk only ever asks this
 * server about its own committed corpus — a general BitJita stub would need
 * real date parsing, this one does not. Full fidelity with BitJita's query
 * surface is not the goal; proving the poller's catch-up loop against this
 * shape is.
 */
export function startBitJitaStubServer(): Promise<BitJitaStubServer> {
	const fixture: BitJitaFixture = JSON.parse(readFileSync(fixturePath, "utf8")) as BitJitaFixture;
	const resolutions = new Map(
		parseResolutionEntries(JSON.parse(readFileSync(resolutionPath, "utf8")) as unknown)
			.map((entry) => [`${entry.kind}:${entry.id}`, entry] as const),
	);
	// How much of the fixture corpus is currently "live". Advances
	// deterministically on every accepted /api/chat call rather than through a
	// separate control channel: the walk's ingest-poll phase already calls
	// /poll in a loop, and since a bounded page is always capped below `limit`
	// (see `pageLimit` below), poller.ts's inner catch-up loop always exits
	// after exactly one /api/chat call — reveal-per-call and reveal-per-poll
	// coincide without the walk phase needing to drive this server directly.
	let revealedCount = 0;

	return new Promise((resolve, reject) => {
		const server: Server = createServer((req, res) => {
			const url = new URL(req.url ?? "/", "http://127.0.0.1");
			if (req.method !== "GET") {
				respondJson(res, 404, { error: "not_found" });
				return;
			}

			const entityIdentity = matchedEntityIdentity(url.pathname);
			if (entityIdentity !== null) {
				const headerViolation = entityHeaderViolation(req.headers);
				if (headerViolation !== null) {
					respondJson(res, 400, { error: "unexpected_headers", detail: headerViolation });
					return;
				}
				if (entityIdentity.kind === "res" && entityIdentity.id === "999999999") {
					respondJson(res, 503, { error: "temporarily_unavailable" });
					return;
				}
				const resolution = resolutions.get(`${entityIdentity.kind}:${entityIdentity.id}`);
				if (resolution === undefined) {
					respondJson(res, 404, { error: "not_found" });
					return;
				}
				respondJson(res, 200, entityResponseBody(resolution));
				return;
			}

			if (url.pathname !== "/api/chat") {
				respondJson(res, 404, { error: "not_found" });
				return;
			}

			const limitParam = url.searchParams.get("limit");
			const limit = limitParam !== null ? Number(limitParam) : fixture.messages.length;
			if (limit > MAX_LIMIT) {
				respondJson(res, 200, { error: "Limit is too high" });
				return;
			}

			revealedCount = Math.min(fixture.messages.length, revealedCount + REVEAL_BATCH_SIZE);
			const revealed = fixture.messages.slice(0, revealedCount);

			const since = url.searchParams.get("since");
			const eligible = since === null ? revealed : revealed.filter((m) => m.timestamp >= since);
			// poller.ts reads a page exactly `limit` rows long on a bounded
			// (`since`) request as the signal that BitJita may have truncated a
			// larger backlog — real BitJita can genuinely do that, but this
			// stub's `revealed` set never loses a row, so that signal would be
			// false every time this server produces it. `eligible` can still
			// reach or exceed `limit` on a bounded request once
			// POLL_OVERLAP_SECONDS is wide enough to pull previously-revealed
			// rows back into the window alongside the newly-revealed batch, so
			// capping one below `limit` only for the unbounded first request is
			// not enough; every bounded page is capped here so this server never
			// emits the truncation signal it cannot back up.
			const pageLimit = since === null ? limit : limit - 1;
			const page = eligible.slice(Math.max(0, eligible.length - pageLimit));

			respondJson(res, 200, { messages: page, total: fixture.messages.length });
		});

		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (address === null || typeof address === "string") {
				reject(new Error("bitjita stub server did not bind to a TCP port"));
				return;
			}
			resolve({
				baseUrl: `http://127.0.0.1:${String(address.port)}`,
				close: () =>
					new Promise<void>((closeResolve, closeReject) => {
						server.close((error) => (error ? closeReject(error) : closeResolve()));
					}),
			});
		});
	});
}
