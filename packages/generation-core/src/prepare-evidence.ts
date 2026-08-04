import { EvidenceMessageSchema, type EvidenceMessage } from "@bc-news/contracts";
import {
	PreparedEvidenceSchema,
	type PreparedEvidence,
	type PreparedMessage,
} from "./prepared-evidence";

const MAX_MESSAGES = 300;
const PER_BUCKET_CAP = Math.ceil(MAX_MESSAGES / 24);
const BURST_WINDOW_MS = 30 * 1000;

type ScoredMessage = PreparedMessage & { score: number };

function compareStrings(a: string, b: string): number {
	if (a < b) return -1;
	if (a > b) return 1;
	return 0;
}

function compareMessages(
	a: Pick<PreparedMessage, "ts" | "id">,
	b: Pick<PreparedMessage, "ts" | "id">,
): number {
	return a.ts - b.ts || compareStrings(a.id, b.id);
}

function compareScoredMessages(a: ScoredMessage, b: ScoredMessage): number {
	return a.score - b.score || compareMessages(a, b);
}

function fnv1a32(value: string): number {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index++) {
		hash ^= value.charCodeAt(index);
		hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
		hash = hash >>> 0;
	}
	return hash;
}

function normalizeText(text: string): string {
	return text
		.trim()
		.replace(/[ \t]+/g, " ")
		// eslint-disable-next-line no-control-regex -- stripping control characters is this expression's purpose (v1 prep behavior)
		.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "");
}

function projectMessage(message: PreparedMessage): PreparedMessage {
	return {
		id: message.id,
		ts: message.ts,
		author_name: message.author_name,
		author_id: message.author_id,
		text: message.text,
	};
}

export function prepareEvidence(input: {
	activeRegionId: string;
	publicationDate: string;
	messages: readonly EvidenceMessage[];
}): PreparedEvidence {
	const { activeRegionId, publicationDate } = input;
	const parsedMessages = EvidenceMessageSchema.array().parse(input.messages);
	const dropStats = {
		empty_after_trim: 0,
		too_short: 0,
		burst_merged: 0,
		sampling_dropped: 0,
	};

	const normalized = parsedMessages
		.map<PreparedMessage>((message) => ({
			id: message.id,
			ts: message.ts,
			author_id: message.author_id,
			author_name: message.author_name ?? "",
			text: normalizeText(message.text),
		}))
		.sort(compareMessages);

	const afterFilter = normalized.filter((message) => {
		if (message.text.length === 0) {
			dropStats.empty_after_trim++;
			return false;
		}
		if (message.text.length < 2) {
			dropStats.too_short++;
			return false;
		}
		return true;
	});

	const afterBurst: PreparedMessage[] = [];
	let previous: PreparedMessage | undefined;
	for (const message of afterFilter) {
		if (
			previous !== undefined &&
			previous.author_id === message.author_id &&
			message.ts - previous.ts <= BURST_WINDOW_MS
		) {
			previous.text = `${previous.text}\n${message.text}`;
			dropStats.burst_merged++;
			continue;
		}

		previous = { ...message };
		afterBurst.push(previous);
	}

	const scored = afterBurst
		.map<ScoredMessage>((message) => ({
			...message,
			score: fnv1a32(`${activeRegionId}|${publicationDate}|${message.id}`),
		}))
		.sort(compareScoredMessages);

	const selected: ScoredMessage[] = [];
	const bucketCounts = new Map<number, number>();
	for (const message of scored) {
		const hour = new Date(message.ts).getUTCHours();
		const count = bucketCounts.get(hour) ?? 0;
		if (count < PER_BUCKET_CAP) {
			selected.push(message);
			bucketCounts.set(hour, count + 1);
		}
	}

	const finalMessages = selected.length > MAX_MESSAGES
		? selected.slice(0, MAX_MESSAGES)
		: selected;
	dropStats.sampling_dropped = afterBurst.length - finalMessages.length;

	return PreparedEvidenceSchema.parse({
		active_region_id: activeRegionId,
		publication_date: publicationDate,
		raw_count: parsedMessages.length,
		after_filter_count: afterFilter.length,
		after_burst_count: afterBurst.length,
		final_count: finalMessages.length,
		drop_stats: dropStats,
		messages: finalMessages.map(projectMessage),
	});
}
