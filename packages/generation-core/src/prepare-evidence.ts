import { EvidenceMessageSchema, type EvidenceMessage } from "@bc-news/contracts";
import { evidenceWindowForPublicationDate } from "./evidence-date";
import { buildPreparedGameReferences } from "./game-reference-tokens";
import {
	PreparedEvidenceSchema,
	type PreparedEvidence,
	type PreparedMessage,
} from "./prepared-evidence";

const BURST_WINDOW_MS = 30 * 1000;

type EvidenceContractErrorCode = "evidence_out_of_window" | "duplicate_evidence_id";

export abstract class EvidenceContractError extends Error {
	abstract readonly code: EvidenceContractErrorCode;
}

export class EvidenceOutOfWindowError extends EvidenceContractError {
	readonly code = "evidence_out_of_window";
	readonly id: string;
	readonly ts: number;
	readonly windowStart: number;
	readonly windowEnd: number;

	constructor(id: string, ts: number, windowStart: number, windowEnd: number) {
		super(
			`Evidence message "${id}" at ts ${ts} falls outside the evidence window [${windowStart}, ${windowEnd})`,
		);
		this.name = "EvidenceOutOfWindowError";
		this.id = id;
		this.ts = ts;
		this.windowStart = windowStart;
		this.windowEnd = windowEnd;
	}
}

export class DuplicateEvidenceIdError extends EvidenceContractError {
	readonly code = "duplicate_evidence_id";
	readonly id: string;

	constructor(id: string) {
		super(`Evidence message id "${id}" appears more than once in the evidence input`);
		this.name = "DuplicateEvidenceIdError";
		this.id = id;
	}
}

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

	/*
	 * Window and duplicate-id checks run here, on the parsed set, ahead of
	 * normalize/filter/burst-merge/sampling. Any later placement lets a lossy
	 * stage mask the violation it exists to catch: burst-merge would silently
	 * fold a duplicate id into its neighbor, and the empty-after-trim filter
	 * would silently drop a whitespace-only out-of-window message.
	 */
	const { startMs: windowStart, endMs: windowEnd } = evidenceWindowForPublicationDate(publicationDate);
	const seenIds = new Set<string>();
	for (const message of parsedMessages) {
		if (message.ts < windowStart || message.ts >= windowEnd) {
			throw new EvidenceOutOfWindowError(message.id, message.ts, windowStart, windowEnd);
		}
		if (seenIds.has(message.id)) {
			throw new DuplicateEvidenceIdError(message.id);
		}
		seenIds.add(message.id);
	}

	const dropStats = {
		empty_after_trim: 0,
		too_short: 0,
		burst_merged: 0,
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

	const finalMessages = afterBurst;

	return PreparedEvidenceSchema.parse({
		active_region_id: activeRegionId,
		publication_date: publicationDate,
		raw_count: parsedMessages.length,
		after_filter_count: afterFilter.length,
		after_burst_count: afterBurst.length,
		final_count: finalMessages.length,
		drop_stats: dropStats,
		game_references: buildPreparedGameReferences(finalMessages),
		messages: finalMessages.map(projectMessage),
	});
}
