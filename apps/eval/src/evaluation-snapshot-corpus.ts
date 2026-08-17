import { access } from "node:fs/promises";
import { z } from "zod";
import {
	MAX_TIMESTAMP_MILLISECONDS,
	MIN_TIMESTAMP_MILLISECONDS,
} from "@bc-news/contracts";
import type { ProductionCorpusSelection } from "./evaluation-corpus-selection";

type SnapshotQueryParameter = number | string;

const SnapshotQueryRowSchema = z.strictObject({
	case_ordinal: z.int().positive(),
	case_id: z.string().min(1),
	active_region_id: z.string().min(1),
	entity_id: z.unknown(),
	timestamp_ts: z.unknown(),
	username_raw: z.unknown(),
	username: z.unknown(),
	text: z.unknown(),
});

export type SnapshotQueryRow = z.infer<typeof SnapshotQueryRowSchema>;

type SnapshotCorpusSqliteErrorCode = "snapshot_open_failed" | "snapshot_query_failed" | "snapshot_row_rejected";

export class SnapshotCorpusSqliteError extends Error {
	readonly code: SnapshotCorpusSqliteErrorCode;
	readonly path: string;

	constructor(code: SnapshotCorpusSqliteErrorCode, path: string, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "SnapshotCorpusSqliteError";
		this.code = code;
		this.path = path;
	}
}

export async function findPresentSnapshotSidecarPath(snapshotPath: string): Promise<string | undefined> {
	for (const suffix of ["-wal", "-shm", "-journal"] as const) {
		const candidate = `${snapshotPath}${suffix}`;
		try {
			await access(candidate);
			return candidate;
		} catch {
			continue;
		}
	}
	return undefined;
}

function buildCaseQuery(selection: ProductionCorpusSelection): {
	readonly sql: string;
	readonly parameters: ReadonlyArray<SnapshotQueryParameter>;
} {
	const parameters: SnapshotQueryParameter[] = [];
	const bind = (value: SnapshotQueryParameter): string => {
		parameters.push(value);
		return `?${String(parameters.length)}`;
	};
	const selectSql = selection.cases.map((entry) => {
		const ordinal = bind(entry.ordinal);
		const caseId = bind(entry.id);
		const regionId = bind(entry.active_region_id);
		const regionNumber = bind(Number(entry.active_region_id));
		const minimumTimestamp = bind(MIN_TIMESTAMP_MILLISECONDS);
		const maximumTimestamp = bind(MAX_TIMESTAMP_MILLISECONDS);
		const windows = entry.windows.map((window) => {
			const start = bind(Date.parse(window.start_utc));
			const end = bind(Date.parse(window.end_utc));
			return `(timestamp_ts >= ${start} AND timestamp_ts < ${end})`;
		}).join(" OR ");
		return `
SELECT ${ordinal} AS case_ordinal,
       ${caseId} AS case_id,
       ${regionId} AS active_region_id,
       entity_id,
       timestamp_ts,
       username_raw,
       username,
       text
  FROM chat_messages
 WHERE region_id = ${regionNumber}
   AND typeof(timestamp_ts) = 'integer'
   AND timestamp_ts >= ${minimumTimestamp}
   AND timestamp_ts <= ${maximumTimestamp}
   AND (${windows})`.trim();
	});
	return {
		sql: `${selectSql.join("\nUNION ALL\n")}\nORDER BY case_ordinal, timestamp_ts, entity_id`,
		parameters,
	};
}

export async function loadSnapshotQueryRows(
	snapshotPath: string,
	selection: ProductionCorpusSelection,
): Promise<readonly SnapshotQueryRow[]> {
	const { DatabaseSync } = await import("node:sqlite");
	const { sql, parameters } = buildCaseQuery(selection);
	let database;
	try {
		database = new DatabaseSync(snapshotPath, { readOnly: true });
	} catch (cause) {
		throw new SnapshotCorpusSqliteError(
			"snapshot_open_failed",
			snapshotPath,
			`Cannot open snapshot for read-only extraction: ${snapshotPath}`,
			{ cause },
		);
	}
	try {
		let rows: unknown[];
		try {
			rows = database.prepare(sql).all(...parameters);
		} catch (cause) {
			throw new SnapshotCorpusSqliteError(
				"snapshot_query_failed",
				snapshotPath,
				`Snapshot query failed for ${snapshotPath}`,
				{ cause },
			);
		}
		const parsed = SnapshotQueryRowSchema.array().safeParse(rows);
		if (!parsed.success) {
			throw new SnapshotCorpusSqliteError(
				"snapshot_row_rejected",
				snapshotPath,
				`Snapshot storage rows failed the extraction row contract for ${snapshotPath}`,
				{ cause: parsed.error },
			);
		}
		return parsed.data;
	} finally {
		database.close();
	}
}
