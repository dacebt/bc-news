import { z } from "zod";

// regionId/channelId/titleId arrive from BitJita as string or number; this
// boundary normalizes both to string so the domain never branches on wire
// representation, and mapping.ts owns the only opinion on what a valid one
// looks like.
const BitJitaIdSchema = z
	.union([z.string(), z.number().finite()])
	.transform((value) => String(value));

// A loose object, not strict: BitJita's live wire messages already carry
// fields this contract does not name (ownerEntityId today, whatever else
// tomorrow), and one unrecognized key on one message must not fail the whole
// page. Unknown keys are tolerated here; mapping.ts still rejects any single
// message whose known fields don't satisfy the domain's requirements.
//
// Every known field is also nullable, not just optional: BitJita puts null
// on the wire for fields it has nothing to report (observed on titleId and
// targetId, but nothing about the wire format confines it to those two), and
// a null is exactly as unusable to mapping.ts as an absent field — both must
// reach its skip path, not fail the whole page's parse.
export const BitJitaMessageSchema = z.looseObject({
	entityId: z.string().nullable().optional(),
	messageId: z.string().nullable().optional(),
	username: z.string().nullable().optional(),
	timestamp: z.string().nullable().optional(),
	regionId: BitJitaIdSchema.nullable().optional(),
	channelId: BitJitaIdSchema.nullable().optional(),
	targetId: BitJitaIdSchema.nullable().optional(),
	titleId: BitJitaIdSchema.nullable().optional(),
	text: z.string().nullable().optional(),
});
export type BitJitaMessage = z.infer<typeof BitJitaMessageSchema>;

// A strict union, not a looser "has messages or has error" check: a body that
// matches neither of these two shapes is exactly as untrustworthy as one
// that fails to parse as JSON at all, and both must throw rather than hand
// the poller an empty page it would mistake for "caught up". Each branch is
// loose, not strict, about its own keys: the same reasoning that makes
// BitJitaMessageSchema tolerate an unmodeled key applies at the envelope
// too — BitJita adding a top-level key (hasMore, nextCursor) must not make
// every branch fail to match and fall through to "matches neither shape".
export const BitJitaResponseSchema = z.union([
	z.looseObject({ error: z.string() }),
	// total is observed to equal the returned page count, not a count BitJita
	// promises to keep matching the messages array — it carries no
	// information the poller can act on, so neither its absence nor its wire
	// type can be allowed to fail parse.
	z.looseObject({ messages: z.array(BitJitaMessageSchema), total: z.unknown().optional() }),
]);
export type BitJitaResponse = z.infer<typeof BitJitaResponseSchema>;

export class BitJitaResponseError extends Error {
	readonly code: "bitjita_http_error" | "bitjita_unparseable_response" | "bitjita_error_response";

	constructor(
		message: string,
		code: BitJitaResponseError["code"],
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "BitJitaResponseError";
		this.code = code;
	}
}

export interface FetchChatMessagesOptions {
	limit: number;
	sinceIso?: string;
}

const REQUEST_HEADERS = {
	Accept: "application/json",
	"Content-Type": "application/json",
	"User-Agent": "news.bccodex",
	"x-app-identifier": "news.bccodex",
};

/**
 * Fetch one page of chat messages from BitJita (or the walk's stub in its
 * place). A non-2xx response and an unparseable or contract-violating body
 * both throw — never a partial or default result — so the poller's own
 * failure handling is the only place a fetch failure is ever decided.
 */
export async function fetchChatMessages(
	options: FetchChatMessagesOptions,
	apiBase: string,
): Promise<BitJitaMessage[]> {
	// A leading slash here would resolve as an absolute path against apiBase,
	// discarding any path segment the deployment configured (a proxy prefix, a
	// versioned base). Resolving a bare relative path against a base forced to
	// end in "/" appends to whatever path apiBase already carries instead.
	const normalizedApiBase = apiBase.endsWith("/") ? apiBase : `${apiBase}/`;
	const url = new URL("api/chat", normalizedApiBase);
	url.searchParams.set("limit", String(options.limit));
	if (options.sinceIso !== undefined) {
		url.searchParams.set("since", options.sinceIso);
	}

	const response = await fetch(url, { headers: REQUEST_HEADERS });
	if (!response.ok) {
		throw new BitJitaResponseError(
			`BitJita API returned HTTP ${String(response.status)}`,
			"bitjita_http_error",
		);
	}

	let raw: unknown;
	try {
		raw = await response.json();
	} catch (cause) {
		throw new BitJitaResponseError(
			"BitJita API response body is not valid JSON",
			"bitjita_unparseable_response",
			{ cause },
		);
	}

	const parsed = BitJitaResponseSchema.safeParse(raw);
	if (!parsed.success) {
		throw new BitJitaResponseError(
			`BitJita API response does not match the expected contract: ${parsed.error.message}`,
			"bitjita_unparseable_response",
			{ cause: parsed.error },
		);
	}
	if ("error" in parsed.data) {
		const detail =
			typeof parsed.data.error === "string" ? parsed.data.error : JSON.stringify(parsed.data.error);
		throw new BitJitaResponseError(
			`BitJita API returned an error: ${detail}`,
			"bitjita_error_response",
		);
	}
	return parsed.data.messages;
}
