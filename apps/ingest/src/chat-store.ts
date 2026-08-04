import { z } from "zod";
import { isEpochMilliseconds } from "./parsers";

// Reuses isEpochMilliseconds rather than a fresh zod range so this read stays
// on the exact same range parseBitJitaTimestamp holds produced timestamps to
// (see parsers.ts) — one range, not two that could drift apart.
const CursorTsSchema = z.custom<number>(isEpochMilliseconds);

/**
 * A poll_state row exists but its cursor_ts is not a usable timestamp.
 * Distinct from D1 being unavailable: no retry fixes it, so the poller
 * reports it under its own failure phase rather than folding it into
 * transient storage trouble.
 */
export class CorruptCursorError extends Error {
	readonly code = "corrupt_cursor";

	constructor(key: string, value: unknown) {
		const described = typeof value === "string" ? JSON.stringify(value) : String(value);
		super(
			`poll_state cursor_ts for key '${key}' is not epoch milliseconds ` +
				`(${typeof value}: ${described.slice(0, 80)})`,
		);
		this.name = "CorruptCursorError";
	}
}

export interface ChatMessageRow {
	entity_id: string;
	region_id: number;
	channel_id: number;
	target_id: string | null;
	title_id: number | null;
	username_raw: string;
	lang: string | null;
	username: string | null;
	text: string;
	timestamp_utc: string;
	timestamp_ts: number;
}

/**
 * Read the cursor timestamp for a key, or null when no row is stored yet.
 *
 * Reads the column as `unknown` rather than trusting a `{ cursor_ts: number }`
 * shape: persisted data is external input like any other. Throws
 * CorruptCursorError when a row exists but does not hold a timestamp —
 * returning null there would report "no cursor yet" and hand the caller a
 * silent restart from the beginning of time.
 */
export async function getCursor(db: D1Database, key: string): Promise<number | null> {
	const row = await db.prepare("SELECT cursor_ts FROM poll_state WHERE key = ?").bind(key).first();
	if (row === null) {
		return null;
	}

	const cursorTs: unknown = row.cursor_ts;
	const result = CursorTsSchema.safeParse(cursorTs);
	if (!result.success) {
		throw new CorruptCursorError(key, cursorTs);
	}
	return result.data;
}

/**
 * Set the cursor timestamp for a key. A monotonic compare-and-set: an
 * existing row only advances when the new value is strictly greater, so a
 * slower invocation that started before a peer but finishes after it can
 * never overwrite the peer's newer progress with its own older watermark.
 * Returns whether the write actually applied — the caller cannot otherwise
 * tell an applied write from one skipped because the stored cursor is
 * already at or past the new value.
 */
export async function setCursor(db: D1Database, key: string, cursorTs: number): Promise<boolean> {
	const result = await db
		.prepare(
			`INSERT INTO poll_state (key, cursor_ts, updated_at)
			 VALUES (?, ?, CURRENT_TIMESTAMP)
			 ON CONFLICT(key) DO UPDATE SET
			   cursor_ts = excluded.cursor_ts,
			   updated_at = CURRENT_TIMESTAMP
			 WHERE excluded.cursor_ts > poll_state.cursor_ts`,
		)
		.bind(key, cursorTs)
		.run();

	return (result.meta.changes ?? 0) > 0;
}

/**
 * Batch-insert messages, ignoring rows whose entity_id already exists.
 * Returns the number of rows actually inserted, not the number offered.
 */
export async function insertMessages(db: D1Database, messages: ChatMessageRow[]): Promise<number> {
	if (messages.length === 0) {
		return 0;
	}

	const stmt = db.prepare(
		`INSERT INTO chat_messages (
			entity_id, region_id, channel_id, target_id, title_id,
			username_raw, lang, username, text, timestamp_utc, timestamp_ts
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(entity_id) DO NOTHING`,
	);

	const batch = messages.map((row) =>
		stmt.bind(
			row.entity_id,
			row.region_id,
			row.channel_id,
			row.target_id,
			row.title_id,
			row.username_raw,
			row.lang,
			row.username,
			row.text,
			row.timestamp_utc,
			row.timestamp_ts,
		),
	);

	const results = await db.batch(batch);
	let inserted = 0;
	for (const result of results) {
		inserted += result.meta.changes ?? 0;
	}
	return inserted;
}
