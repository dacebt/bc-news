import { beforeEach, expect, it, vi } from "vitest";
import type { PollRunEnv } from "../src/poll-run";
import { handlePoll } from "../src/routes";

const mockPollChatMessages = vi.fn();

vi.mock("../src/poller", async (importOriginal) => {
	const original = await importOriginal<typeof import("../src/poller")>();
	return {
		...original,
		pollChatMessages: (...args: unknown[]) => mockPollChatMessages(...args) as unknown,
	};
});

const ENV = {
	DB: {} as D1Database,
	POLL_LIMIT: "100",
	POLL_OVERLAP_SECONDS: "10",
	POLL_CURSOR_KEY: "chat_firehose",
	BITJITA_API_BASE: "http://stub.local",
} satisfies PollRunEnv;

beforeEach(() => {
	vi.resetAllMocks();
});

it("lets an unexpected poller rejection escape", async () => {
	mockPollChatMessages.mockRejectedValue(new Error("unmodeled poll failure"));

	await expect(handlePoll(ENV)).rejects.toThrow("unmodeled poll failure");
});

it("preserves the manual poll response for a complete run", async () => {
	mockPollChatMessages.mockResolvedValue({
		outcome: "complete",
		insertedCount: 3,
		skippedInvalid: 1,
		cursorTs: 123,
		cursorPersisted: true,
	});

	const response = await handlePoll(ENV);
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({
		outcome: "complete",
		inserted_count: 3,
		skipped_invalid: 1,
		cursor_ts: 123,
	});
});

it("preserves the manual poll 502 response for a modeled failure", async () => {
	mockPollChatMessages.mockResolvedValue({
		outcome: "failed",
		insertedCount: 0,
		skippedInvalid: 0,
		cursorTs: null,
		cursorPersisted: false,
		failure: { phase: "first_page", message: "upstream unavailable" },
	});

	const response = await handlePoll(ENV);
	expect(response.status).toBe(502);
	expect(await response.json()).toMatchObject({
		outcome: "failed",
		failure: { phase: "first_page", message: "upstream unavailable" },
	});
});

it("preserves the manual poll 500 response for invalid configuration", async () => {
	const invalidEnv: PollRunEnv = {
		DB: ENV.DB,
		POLL_LIMIT: ENV.POLL_LIMIT,
		POLL_OVERLAP_SECONDS: ENV.POLL_OVERLAP_SECONDS,
		POLL_CURSOR_KEY: ENV.POLL_CURSOR_KEY,
	};
	const response = await handlePoll(invalidEnv);
	expect(response.status).toBe(500);
	expect(await response.json()).toMatchObject({ error: "invalid_poll_config" });
});
