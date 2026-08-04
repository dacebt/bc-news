import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { EvidenceFixtureSchema, type EvidenceMessage } from "@bc-news/contracts";
import { evidenceDateForPublicationDate, evidenceWindowForPublicationDate } from "@bc-news/generation-core";

const ACTIVE_REGION_ID = "7";
const PUBLICATION_DATE = "2026-01-25";
const EVIDENCE_DATE = evidenceDateForPublicationDate(PUBLICATION_DATE);
const { startMs: WINDOW_START_TS, endMs: WINDOW_END_TS } = evidenceWindowForPublicationDate(PUBLICATION_DATE);
const MAX_OUTPUT_BYTES = 250 * 1024;

const SourceMessageSchema = z.looseObject({
	entity_id: z.string().min(1),
	region_id: z.int(),
	username_raw: z.string().min(1),
	username: z.string().nullable(),
	text: z.string(),
	timestamp_ts: z.int(),
});

const SourcePagesSchema = z.array(
	z.looseObject({ results: z.array(SourceMessageSchema) }),
);

const sourcePath = process.argv[2];
if (sourcePath === undefined) {
	throw new Error(
		"Usage: derive-evidence-fixture <path to frozen v1 messages_2026-01-24.json>",
	);
}

const sourcePages = SourcePagesSchema.parse(
	JSON.parse(readFileSync(sourcePath, "utf8")),
);

const messages: EvidenceMessage[] = sourcePages
	.flatMap((page) => page.results)
	.filter(
		(row) =>
			row.region_id === Number(ACTIVE_REGION_ID) &&
			row.timestamp_ts >= WINDOW_START_TS &&
			row.timestamp_ts < WINDOW_END_TS,
	)
	.map((row) => ({
		id: row.entity_id,
		ts: row.timestamp_ts,
		author_id: row.username_raw,
		author_name: row.username,
		text: row.text,
	}))
	.sort((a, b) => a.ts - b.ts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

const fixture = EvidenceFixtureSchema.parse({
	active_region_id: ACTIVE_REGION_ID,
	evidence_date: EVIDENCE_DATE,
	messages,
});

const serialized = `${JSON.stringify(fixture, null, "\t")}\n`;
const byteLength = Buffer.byteLength(serialized, "utf8");
if (byteLength > MAX_OUTPUT_BYTES) {
	throw new Error(
		`Derived fixture is ${byteLength} bytes, above the ${MAX_OUTPUT_BYTES}-byte commit bound; not writing`,
	);
}

const outputPath = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"evidence",
	`active-region-${ACTIVE_REGION_ID}_${EVIDENCE_DATE}.json`,
);
writeFileSync(outputPath, serialized);
process.stdout.write(
	`Wrote ${fixture.messages.length} messages (${byteLength} bytes) to ${outputPath}\n`,
);
