import { fetchChatMessages, type BitJitaMessage } from "./bitjita-client";
import { CorruptCursorError, getCursor, insertMessages, setCursor, type ChatMessageRow } from "./chat-store";
import { mapMessageToRow } from "./mapping";
import type { PollConfig } from "./config";

export type PollFailurePhase =
	| "first_page"
	| "catch_up"
	| "stuck"
	| "storage"
	| "corrupt_cursor"
	| "gap"
	| "oversized_page";

interface PollResultEvidence {
	insertedCount: number;
	skippedInvalid: number;
	cursorTs: number | null;
	cursorPersisted: boolean;
}

// outcome is derived from observable evidence (rows inserted, cursor
// persisted) below, never from which `break` fired — a value asserting
// forward progress must be backed by it.
export type PollResult =
	| (PollResultEvidence & { outcome: "complete" })
	| (PollResultEvidence & {
			outcome: "partial" | "failed";
			failure: { phase: PollFailurePhase; message: string };
	  });

const STUCK_THRESHOLD = 3;

/**
 * Poll BitJita chat messages with overlap and a catch-up loop. Idempotent,
 * and drains the whole backlog visible at call time in one invocation.
 */
export async function pollChatMessages(db: D1Database, config: PollConfig): Promise<PollResult> {
	let insertedCount = 0;
	let skippedInvalid = 0;

	let storedCursor: number | null;
	try {
		storedCursor = await getCursor(db, config.pollCursorKey);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		// A corrupt stored cursor and an unreachable D1 both stop the poll here,
		// but they call for opposite responses: the second clears on retry, the
		// first will fail identically every tick until a human repairs the row.
		const phase: PollFailurePhase = error instanceof CorruptCursorError ? "corrupt_cursor" : "storage";
		return {
			insertedCount: 0,
			skippedInvalid: 0,
			cursorTs: null,
			cursorPersisted: false,
			outcome: "failed",
			failure: { phase, message },
		};
	}

	let acceptedWatermark: number | null = storedCursor;
	const overlapMs = config.pollOverlapSeconds * 1000;
	let hasAcceptedMessages = false;
	// The failure to report, if any. The first halting cause wins and is
	// never overwritten by a later one. "gap" is not a halting cause — it
	// never occupies this slot directly. It flags a since-bounded page that
	// may have skipped rows without halting the drain that follows it, so it
	// is tracked separately below and only folded in here once the loop and
	// the cursor write are both done, as the lowest-priority cause: a real
	// halting failure always outranks an advisory one.
	let failure: { phase: PollFailurePhase; message: string } | null = null;
	let gapWarning: { phase: "gap"; message: string } | null = null;
	let lastWatermark = acceptedWatermark;
	let stuckCount = 0;
	let iterations = 0;

	while (true) {
		iterations++;
		const sinceIso =
			acceptedWatermark !== null ? new Date(acceptedWatermark - overlapMs).toISOString() : undefined;

		let messages: BitJitaMessage[];
		try {
			messages = await fetchChatMessages(
				{ limit: config.pollLimit, ...(sinceIso !== undefined ? { sinceIso } : {}) },
				config.bitjitaApiBase,
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (iterations === 1) {
				return {
					insertedCount: 0,
					skippedInvalid: 0,
					cursorTs: acceptedWatermark,
					cursorPersisted: false,
					outcome: "failed",
					failure: { phase: "first_page", message },
				};
			}
			failure ??= { phase: "catch_up", message };
			break;
		}

		if (messages.length === 0) {
			break;
		}

		// This loop's only convergence paths are a page smaller than the limit
		// (caught up) and the stuck detector (a page exactly at the limit with
		// no watermark movement, three times). A page larger than the limit
		// just requested satisfies neither: since would recompute identically
		// and the same oversized page would return forever. The boundary layer
		// does not validate cardinality against the limit it asked for, so this
		// loop must refuse to trust it rather than spin.
		if (messages.length > config.pollLimit) {
			failure ??= {
				phase: "oversized_page",
				message: `BitJita returned ${String(messages.length)} messages for a page limit of ${String(config.pollLimit)}; refusing to continue a loop whose convergence depends on the page never exceeding the requested limit.`,
			};
			break;
		}

		const rows: ChatMessageRow[] = [];
		let batchWatermark = acceptedWatermark;
		for (const msg of messages) {
			const row = mapMessageToRow(msg);
			if (row === null) {
				skippedInvalid++;
				continue;
			}
			rows.push(row);
			// The watermark only ever moves to a timestamp on a row that is
			// about to be offered to storage — a rejected message must not
			// advance the poll past itself.
			batchWatermark = batchWatermark === null ? row.timestamp_ts : Math.max(batchWatermark, row.timestamp_ts);
		}

		if (rows.length > 0) {
			let actuallyInserted: number;
			try {
				actuallyInserted = await insertMessages(db, rows);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				failure ??= { phase: "storage", message };
				break;
			}
			insertedCount += actuallyInserted;
			hasAcceptedMessages = true;
			acceptedWatermark = batchWatermark;
		}

		// The observed BitJita contract returns the newest `limit` eligible
		// rows for a bounded `since`, not an oldest-first prefix — so a page
		// this full on a request that carried `since` means rows between it
		// and this page's oldest row may sit in a backlog no later `since`
		// value can ever reach again. The watermark still advances: refusing
		// to would recompute the same `since` next tick and only trade this
		// for the stuck failure below, and the gap is unreachable either way.
		// A first-ever poll (no `since` yet) is the normal bootstrap tail, not
		// a gap.
		if (sinceIso !== undefined && messages.length === config.pollLimit && rows.length > 0) {
			const oldestRowTs = Math.min(...rows.map((row) => row.timestamp_ts));
			gapWarning ??= {
				phase: "gap",
				message: `BitJita returned a full page (${String(messages.length)}) for since=${sinceIso}; rows in [${sinceIso}, ${new Date(oldestRowTs).toISOString()}] may be permanently unreachable.`,
			};
		}

		if (acceptedWatermark === lastWatermark && messages.length === config.pollLimit) {
			stuckCount++;
			if (stuckCount >= STUCK_THRESHOLD) {
				failure ??= {
					phase: "stuck",
					message: `Poll loop appears stuck: cursor not advancing (${String(acceptedWatermark)}) but fetching ${String(messages.length)} messages.`,
				};
				break;
			}
		} else {
			stuckCount = 0;
		}
		lastWatermark = acceptedWatermark;

		if (messages.length < config.pollLimit) {
			break;
		}
	}

	let cursorPersisted = false;
	if (hasAcceptedMessages && acceptedWatermark !== null) {
		try {
			// setCursor is a monotonic compare-and-set: it returns false, not an
			// error, when the stored cursor is already at or past this
			// watermark — either a concurrent invocation advanced it, or (the
			// common case) this poll's overlap window re-fetched rows it had
			// already ingested and recomputed the same watermark. Either way it
			// must not surface as a failure.
			cursorPersisted = await setCursor(db, config.pollCursorKey, acceptedWatermark);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			failure ??= { phase: "storage", message };
		}
	}

	// gap folds in last, and only if nothing else failed: it is advisory,
	// never the reason the loop stopped, so a real halting cause (stuck,
	// storage, catch_up, corrupt_cursor) always takes the single failure
	// slot over it.
	failure ??= gapWarning;

	const evidence: PollResultEvidence = {
		insertedCount,
		skippedInvalid,
		// The watermark actually persisted to poll_state this invocation —
		// never the in-memory watermark when the write did not durably land,
		// whether skipped (stored cursor already at or past it) or failed.
		cursorTs: cursorPersisted ? acceptedWatermark : storedCursor,
		cursorPersisted,
	};

	if (failure === null) {
		return { ...evidence, outcome: "complete" };
	}

	// outcome asserts how far this invocation got, derived purely from
	// observed evidence, never from *why* it stopped. A stuck loop's
	// non-convergence is carried by failure.phase === "stuck", not by
	// forcing outcome to "failed" here.
	const madeForwardProgress = insertedCount > 0 || cursorPersisted;
	const outcome = madeForwardProgress ? "partial" : "failed";
	return { ...evidence, outcome, failure };
}
