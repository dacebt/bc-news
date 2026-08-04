import {
	ActiveRegionIdSchema,
	EvidenceMessageSchema,
	MAX_TIMESTAMP_MILLISECONDS,
	MIN_TIMESTAMP_MILLISECONDS,
	type EvidenceMessage,
} from "@bc-news/contracts";
import { evidenceWindowForEvidenceDate, type EvidenceInputPort } from "@bc-news/generation-core";

type D1ChatEvidenceErrorCode = "d1_chat_evidence_region_id_invalid" | "d1_chat_evidence_row_invalid";

/**
 * A boundary rejection specific to reading chat_messages back out of D1: the
 * offending row (or the active region id the query could not run with) is
 * carried on the error so a caller can identify what to fix in storage
 * without re-running the query. Stored rows are written by the ingest
 * worker's own validated mapping, so either failure means corruption, not a
 * shape the adapter should coerce or skip past.
 */
export class D1ChatEvidenceError extends Error {
	readonly code: D1ChatEvidenceErrorCode;
	readonly activeRegionId: string;
	readonly evidenceDate: string;
	readonly entityId: string | undefined;

	constructor(
		code: D1ChatEvidenceErrorCode,
		message: string,
		context: { activeRegionId: string; evidenceDate: string; entityId?: string },
		cause?: unknown,
	) {
		super(message, cause === undefined ? undefined : { cause });
		this.name = "D1ChatEvidenceError";
		this.code = code;
		this.activeRegionId = context.activeRegionId;
		this.evidenceDate = context.evidenceDate;
		this.entityId = context.entityId;
	}
}

function toRegionId(activeRegionId: string, evidenceDate: string): number {
	if (!ActiveRegionIdSchema.safeParse(activeRegionId).success) {
		throw new D1ChatEvidenceError(
			"d1_chat_evidence_region_id_invalid",
			`Active region id "${activeRegionId}" is not a canonical positive decimal region id and cannot match a stored chat_messages.region_id identity`,
			{ activeRegionId, evidenceDate },
		);
	}
	const parsed = Number(activeRegionId);
	return parsed;
}

interface ChatMessageRow {
	entity_id: string;
	timestamp_ts: number;
	username_raw: string;
	username: string | null;
	text: string;
}

function toEvidenceMessage(
	row: ChatMessageRow,
	activeRegionId: string,
	evidenceDate: string,
): EvidenceMessage {
	const result = EvidenceMessageSchema.safeParse({
		id: row.entity_id,
		ts: row.timestamp_ts,
		author_id: row.username_raw,
		author_name: row.username,
		text: row.text,
	});
	if (!result.success) {
		throw new D1ChatEvidenceError(
			"d1_chat_evidence_row_invalid",
			`chat_messages row ${row.entity_id} fails the evidence message contract on read-back`,
			{ activeRegionId, evidenceDate, entityId: row.entity_id },
			result.error,
		);
	}
	return result.data;
}

/**
 * Reads evidence for one active region and evidence date out of the ingest
 * worker's chat_messages table -- the D1-backed counterpart to
 * fixtureEvidenceInput, selected via EVIDENCE_INPUT=d1_chat. Zero rows in the
 * window is a valid, empty result: the no-evidence decision is prepareEvidence's
 * in the core, not this adapter's to make.
 */
export function d1ChatEvidenceInput(db: D1Database): EvidenceInputPort {
	return {
		async loadEvidence({ activeRegionId, evidenceDate }): Promise<EvidenceMessage[]> {
			const regionId = toRegionId(activeRegionId, evidenceDate);
			const { startMs, endMs } = evidenceWindowForEvidenceDate(evidenceDate);

			const result = await db
				.prepare(
					`SELECT entity_id, timestamp_ts, username_raw, username, text
					 FROM chat_messages
					 WHERE region_id = ?1
					   AND (
					     typeof(timestamp_ts) <> 'integer'
					     OR (
					       typeof(timestamp_ts) = 'integer'
					       AND (
					         timestamp_ts < ?4
					         OR timestamp_ts > ?5
					         OR (timestamp_ts >= ?2 AND timestamp_ts < ?3)
					       )
					     )
					   )
					 ORDER BY timestamp_ts, entity_id`,
				)
				.bind(
					regionId,
					startMs,
					endMs,
					MIN_TIMESTAMP_MILLISECONDS,
					MAX_TIMESTAMP_MILLISECONDS,
				)
				.all<ChatMessageRow>();

			return result.results.map((row) => toEvidenceMessage(row, activeRegionId, evidenceDate));
		},
	};
}
