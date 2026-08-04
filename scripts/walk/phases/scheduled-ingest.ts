import { readFileSync } from "node:fs";
import { fixturePath } from "../bitjita-stub-server";
import { chatMessageCount } from "../d1-query";
import type { WalkContext, WalkPhase } from "../phase";
import { dispatchScheduledEvent } from "../scheduled-event";

const MAX_SCHEDULED_POLLS = 20;

function fixtureMessageCount(): number {
	const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as { messages: unknown[] };
	return fixture.messages.length;
}

async function dispatchIngest(ctx: WalkContext): Promise<void> {
	const result = await dispatchScheduledEvent(ctx.ingestBaseUrl, ctx.ingestCron, ctx.scheduledTime);
	if (result.status !== 200) {
		throw new Error(`scheduled ingest expected 200, got ${result.status} ${result.body}`);
	}
}

async function run(ctx: WalkContext): Promise<void> {
	const expectedCount = fixtureMessageCount();
	let observedCount = await chatMessageCount(ctx.generationDir, ctx.persistDir);
	let polls = 0;
	while (observedCount < expectedCount) {
		polls++;
		if (polls > MAX_SCHEDULED_POLLS) {
			throw new Error(
				`scheduled ingest did not drain the fixture within ${String(MAX_SCHEDULED_POLLS)} ticks: D1 holds ${String(observedCount)} of ${String(expectedCount)} rows`,
			);
		}
		await dispatchIngest(ctx);
		observedCount = await chatMessageCount(ctx.generationDir, ctx.persistDir);
		console.log(
			`walk: scheduled ingest tick #${String(polls)} left ${String(observedCount)}/${String(expectedCount)} fixture rows in D1`,
		);
	}
	if (observedCount !== expectedCount) {
		throw new Error(
			`scheduled ingest stored more rows than the fixture holds: ${String(observedCount)} of ${String(expectedCount)}`,
		);
	}

	await dispatchIngest(ctx);
	const repeatedCount = await chatMessageCount(ctx.generationDir, ctx.persistDir);
	if (repeatedCount !== expectedCount) {
		throw new Error(
			`repeated scheduled ingest changed the exact D1 fixture count from ${String(expectedCount)} to ${String(repeatedCount)}`,
		);
	}
	console.log(
		`walk: scheduled ingest stored exactly ${String(expectedCount)} fixture rows; repeated tick preserved the count`,
	);
}

export const walkPhase: WalkPhase = { name: "scheduled-ingest", run };
