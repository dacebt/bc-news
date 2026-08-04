import type { BitJitaMessage } from "./bitjita-client";
import type { ChatMessageRow } from "./chat-store";
import { parseBitJitaTimestamp, parseDecimalInteger, parseUsername } from "./parsers";

// parseUsername splits positionally on the first "/" with no constraint on
// what precedes it, so "AC/DC" reads as lang "AC", username "DC" — a
// truncation of a name nobody sent. Constraining the split's lang half to a
// language-code shape here makes it total instead of positional: a prefix
// that does not look like a language is not a language prefix, and the whole
// raw string is kept as the username instead.
const LANGUAGE_CODE = /^[a-z]{2}(-[A-Z]{2})?$/;

/**
 * Turn one inbound BitJita message into the row it will be stored as, or null
 * when it is not storable.
 *
 * Every rejection collapses to a single null rather than a reason: the
 * poller's only modeled response to an unusable message is to count it in
 * skippedInvalid and move on, so a richer return type would carry
 * information no caller acts on.
 */
export function mapMessageToRow(msg: BitJitaMessage): ChatMessageRow | null {
	// messageId is a fallback for the identity of the row and nothing else — a
	// message carrying neither has no stable key to deduplicate on.
	const entityId = msg.entityId || msg.messageId;
	if (
		!entityId ||
		!msg.username ||
		!msg.regionId ||
		!msg.channelId ||
		!msg.text ||
		!msg.timestamp
	) {
		return null;
	}

	const timestampTs = parseBitJitaTimestamp(msg.timestamp);
	if (timestampTs === null) {
		return null;
	}

	const regionId = parseDecimalInteger(msg.regionId);
	const channelId = parseDecimalInteger(msg.channelId);
	if (regionId === null || channelId === null) {
		return null;
	}

	// Absent titleId is legitimate; present-but-unparsable is not, and must not
	// be quietly stored as the same null an absent one produces.
	const titleId = msg.titleId ? parseDecimalInteger(msg.titleId) : null;
	if (msg.titleId && titleId === null) {
		return null;
	}

	const splitUsername = parseUsername(msg.username);
	const { lang, username } =
		splitUsername.lang !== null && LANGUAGE_CODE.test(splitUsername.lang)
			? splitUsername
			: { lang: null, username: msg.username };
	// A language-prefix-only username ("en/") is truthy at the guard above but
	// splits to an empty name — the same missing-author state that guard
	// exists to reject, reached through a different door. This only fires for
	// a lang that is shaped like a language code; anything else falls through
	// to the raw-string fallback above and is never empty here.
	if (!username) {
		return null;
	}

	return {
		entity_id: entityId,
		region_id: regionId,
		channel_id: channelId,
		target_id: msg.targetId || null,
		title_id: titleId,
		username_raw: msg.username,
		lang,
		username,
		text: msg.text,
		timestamp_utc: msg.timestamp,
		timestamp_ts: timestampTs,
	};
}
