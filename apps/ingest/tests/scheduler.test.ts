import { expect, it, vi } from "vitest";
import type { PollRunEnv } from "../src/poll-run";
import { schedulePoll } from "../src/scheduler";

const ENV = {
	DB: {} as D1Database,
	POLL_LIMIT: "100",
	POLL_OVERLAP_SECONDS: "10",
	POLL_CURSOR_KEY: "chat_firehose",
	BITJITA_API_BASE: "http://stub.local",
} satisfies PollRunEnv;

it("scheduled ingest completes after directly awaiting a complete poll", async () => {
	const runner = vi.fn().mockResolvedValue({
		outcome: "complete",
		insertedCount: 12,
		skippedInvalid: 0,
		cursorTs: 1,
		cursorPersisted: true,
	});

	await expect(schedulePoll(ENV, runner)).resolves.toBeUndefined();
	expect(runner).toHaveBeenCalledOnce();
});

it.each(["partial", "failed"] as const)(
	"scheduled ingest surfaces a %s poll with its phase and message",
	async (outcome) => {
		const runner = vi.fn().mockResolvedValue({
			outcome,
			insertedCount: outcome === "partial" ? 1 : 0,
			skippedInvalid: 0,
			cursorTs: null,
			cursorPersisted: false,
			failure: { phase: "storage", message: "D1 unavailable" },
		});

		await expect(schedulePoll(ENV, runner)).rejects.toThrow(
			`Scheduled ingest poll ${outcome} during storage: D1 unavailable`,
		);
	},
);

it("scheduled ingest lets an invalid configuration escape", async () => {
	const invalidEnv: PollRunEnv = {
		DB: ENV.DB,
		POLL_LIMIT: ENV.POLL_LIMIT,
		POLL_OVERLAP_SECONDS: ENV.POLL_OVERLAP_SECONDS,
		POLL_CURSOR_KEY: ENV.POLL_CURSOR_KEY,
	};
	await expect(schedulePoll(invalidEnv)).rejects.toThrow(
		"Poll config vars rejected",
	);
});

it("scheduled ingest lets an unexpected poll rejection escape", async () => {
	const runner = vi.fn().mockRejectedValue(new Error("unmodeled poll failure"));
	await expect(schedulePoll(ENV, runner)).rejects.toThrow("unmodeled poll failure");
});
