import { readFileSync } from "node:fs";
import { fixturePath } from "../bitjita-stub-server";
import type { WalkContext, WalkPhase } from "../phase";

interface PollResponseBody {
	outcome: string;
	inserted_count: number;
	skipped_invalid: number;
	cursor_ts: number | null;
}

function fixtureMessageCount(): number {
	const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as { messages: unknown[] };
	return fixture.messages.length;
}

async function postPoll(ctx: WalkContext): Promise<PollResponseBody> {
	const response = await fetch(`${ctx.ingestBaseUrl}/poll`, { method: "POST" });
	const text = await response.text();
	if (response.status !== 200) {
		throw new Error(`ingest poll expected 200, got ${response.status} ${text}`);
	}
	return JSON.parse(text) as PollResponseBody;
}

// The stub reveals the fixture corpus in batches smaller than the poll limit
// (bitjita-stub-server.ts REVEAL_BATCH_SIZE), mirroring the observed BitJita
// contract where since+limit returns only the newest window, never an
// oldest-first prefix — a backlog deeper than one page cannot land in a
// single poll. This bounds how many polls draining the fixture can honestly
// take; a run that still hasn't drained by then is a real defect, not a slow
// corpus.
const MAX_POLLS = 20;

async function run(ctx: WalkContext): Promise<void> {
	// Asserted against the fixture file itself, not a number restated here —
	// the two must not be able to drift apart.
	const expectedCount = fixtureMessageCount();

	let totalInserted = 0;
	let polls = 0;
	while (totalInserted < expectedCount) {
		polls++;
		if (polls > MAX_POLLS) {
			throw new Error(
				`ingest poll did not drain the fixture within ${String(MAX_POLLS)} polls: inserted ${String(totalInserted)} of ${String(expectedCount)}`,
			);
		}
		const result = await postPoll(ctx);
		if (result.outcome !== "complete") {
			throw new Error(
				`ingest poll #${String(polls)} expected outcome complete, got ${JSON.stringify(result)}`,
			);
		}
		totalInserted += result.inserted_count;
		console.log(
			`walk: ingest poll #${String(polls)} inserted ${String(result.inserted_count)} rows (${String(totalInserted)}/${String(expectedCount)})`,
		);
	}
	if (totalInserted !== expectedCount) {
		throw new Error(
			`ingest poll inserted more rows than the fixture holds: ${String(totalInserted)} of ${String(expectedCount)}`,
		);
	}

	const drained = await postPoll(ctx);
	if (drained.outcome !== "complete" || drained.inserted_count !== 0) {
		throw new Error(
			`final ingest poll expected outcome complete and inserted_count 0 (drained), got ${JSON.stringify(drained)}`,
		);
	}
	console.log("walk: re-poll inserted 0 rows — dedup, overlap, and full drain proven through the shared local D1");
}

export const walkPhase: WalkPhase = { name: "ingest-poll", run };
