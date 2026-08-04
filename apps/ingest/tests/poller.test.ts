import { assert, beforeEach, expect, it, vi } from "vitest";
import type { BitJitaMessage } from "../src/bitjita-client";
import { CorruptCursorError } from "../src/chat-store";
import type { PollConfig } from "../src/config";
import { pollChatMessages } from "../src/poller";

const mockFetchChatMessages = vi.fn();
const mockGetCursor = vi.fn();
const mockSetCursor = vi.fn();
const mockInsertMessages = vi.fn();

vi.mock("../src/bitjita-client", () => ({
	fetchChatMessages: (...args: unknown[]) => mockFetchChatMessages(...args) as unknown,
}));

// Only the three D1-touching functions are replaced. CorruptCursorError is
// kept real via importOriginal: the poller narrows on it with instanceof, so
// a stubbed stand-in would let this suite agree with a poller that had
// stopped recognizing the error the real store actually throws.
vi.mock("../src/chat-store", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/chat-store")>()),
	getCursor: (...args: unknown[]) => mockGetCursor(...args) as unknown,
	setCursor: (...args: unknown[]) => mockSetCursor(...args) as unknown,
	insertMessages: (...args: unknown[]) => mockInsertMessages(...args) as unknown,
}));

const CONFIG: PollConfig = {
	pollLimit: 100,
	pollOverlapSeconds: 10,
	pollCursorKey: "chat_firehose",
	bitjitaApiBase: "http://stub.local",
};

function message(overrides: Partial<BitJitaMessage> & { entityId: string; timestamp: string }): BitJitaMessage {
	return {
		username: "Player",
		regionId: "10",
		channelId: "2",
		text: "Message",
		...overrides,
	};
}

const DB = {} as D1Database;

beforeEach(() => {
	vi.resetAllMocks();
	// Every test below cares about a healthy single-invocation write unless
	// it overrides this explicitly.
	mockSetCursor.mockResolvedValue(true);
});

it("subtracts the configured overlap when computing since for the next page", async () => {
	const baseCursor = 1_000_000_000_000;
	mockGetCursor.mockResolvedValue(baseCursor);
	mockFetchChatMessages.mockResolvedValueOnce([
		message({ entityId: "msg_1", timestamp: new Date(baseCursor + 5_000).toISOString() }),
	]);
	mockInsertMessages.mockResolvedValue(1);

	await pollChatMessages(DB, { ...CONFIG, pollOverlapSeconds: 10 });

	const firstCall = mockFetchChatMessages.mock.calls[0]?.[0] as { sinceIso?: string };
	expect(firstCall.sinceIso).toBe(new Date(baseCursor - 10_000).toISOString());
});

it("advances the watermark only over rows offered to storage, never a rejected one", async () => {
	const baseCursor = 1_000_000_000_000;
	const acceptedTs = baseCursor + 60_000;
	const rejectedTs = baseCursor + 120_000;
	mockGetCursor.mockResolvedValue(baseCursor);
	mockFetchChatMessages
		.mockResolvedValueOnce([
			message({ entityId: "accepted", timestamp: new Date(acceptedTs).toISOString() }),
			message({
				entityId: "rejected",
				timestamp: new Date(rejectedTs).toISOString(),
				regionId: "not-a-number",
			}),
		])
		.mockResolvedValueOnce([]);
	mockInsertMessages.mockResolvedValue(1);

	const result = await pollChatMessages(DB, { ...CONFIG, pollLimit: 2 });

	expect(result.cursorTs).toBe(acceptedTs);
	expect(result.skippedInvalid).toBe(1);
	expect(mockInsertMessages).toHaveBeenCalledWith(DB, [
		expect.objectContaining({ entity_id: "accepted", timestamp_ts: acceptedTs }),
	]);
});

it("does not report the cursor as persisted when the compare-and-set is a no-op", async () => {
	const baseCursor = 1_000_000_000_000;
	const messageTs = baseCursor + 10_000;
	mockGetCursor.mockResolvedValue(baseCursor);
	mockFetchChatMessages.mockResolvedValueOnce([
		message({ entityId: "msg_1", timestamp: new Date(messageTs).toISOString() }),
	]);
	mockInsertMessages.mockResolvedValue(1);
	// A peer already advanced the stored cursor past this watermark.
	mockSetCursor.mockResolvedValue(false);

	const result = await pollChatMessages(DB, CONFIG);

	expect(result.cursorPersisted).toBe(false);
	// storedCursor is the value known durable; asserting messageTs here would
	// claim a write that never landed.
	expect(result.cursorTs).toBe(baseCursor);
	// A skipped CAS write is healthy concurrency, not a failure.
	expect(result.outcome).toBe("complete");
});

it("reports the cursor as persisted when the compare-and-set applies", async () => {
	const baseCursor = 1_000_000_000_000;
	const messageTs = baseCursor + 10_000;
	mockGetCursor.mockResolvedValue(baseCursor);
	mockFetchChatMessages.mockResolvedValueOnce([
		message({ entityId: "msg_1", timestamp: new Date(messageTs).toISOString() }),
	]);
	mockInsertMessages.mockResolvedValue(1);

	const result = await pollChatMessages(DB, CONFIG);

	expect(result.cursorPersisted).toBe(true);
	expect(result.cursorTs).toBe(messageTs);
});

it("reports outcome partial with phase stuck after three full but unstorable pages with no watermark movement", async () => {
	const seedTs = 1_000_000_000_000;
	mockGetCursor.mockResolvedValue(null);
	const seedBatch: BitJitaMessage[] = Array.from({ length: 100 }, (_, i) =>
		message({ entityId: `seed_${String(i)}`, timestamp: new Date(seedTs).toISOString() }),
	);
	// Every message in the batch is invalid (rows.length === 0), so the gap
	// check — which only ever fires over rows actually offered to storage —
	// stays silent and this locks the stuck detector in isolation.
	const stuckBatch: BitJitaMessage[] = Array.from({ length: 100 }, (_, i) =>
		message({
			entityId: `stuck_${String(i)}`,
			username: "",
			timestamp: new Date(seedTs + 1_000).toISOString(),
		}),
	);
	mockFetchChatMessages.mockResolvedValueOnce(seedBatch).mockResolvedValue(stuckBatch);
	mockInsertMessages.mockResolvedValue(1);

	const result = await pollChatMessages(DB, CONFIG);

	// outcome answers "how far did we get", backed by the forward progress
	// (inserted rows, persisted cursor) this run actually made; the
	// non-convergence itself is carried by failure.phase, not by outcome.
	assert(result.outcome === "partial");
	expect(result.failure.phase).toBe("stuck");
});

it("derives outcome partial (not failed) when a catch-up failure follows a page that made forward progress", async () => {
	const firstBatchTs = 1_000_000_010_000;
	// No stored cursor: the first request carries no `since`, so this full
	// first page is the normal bootstrap tail rather than a gap, leaving the
	// catch-up failure on page two as the only cause.
	mockGetCursor.mockResolvedValue(null);
	mockFetchChatMessages
		.mockResolvedValueOnce([
			message({ entityId: "msg_1", timestamp: new Date(firstBatchTs).toISOString() }),
			message({ entityId: "msg_2", timestamp: new Date(firstBatchTs + 1).toISOString() }),
		])
		.mockRejectedValueOnce(new Error("second page failed"));
	mockInsertMessages.mockResolvedValue(2);

	const result = await pollChatMessages(DB, { ...CONFIG, pollLimit: 2 });

	assert(result.outcome === "partial");
	expect(result.failure).toEqual({ phase: "catch_up", message: "second page failed" });
	expect(result.cursorPersisted).toBe(true);
	expect(result.cursorTs).toBe(firstBatchTs + 1);
});

it("derives outcome failed (not partial) when a catch-up failure follows a page that inserted nothing", async () => {
	const baseCursor = 1_000_000_000_000;
	mockGetCursor.mockResolvedValue(baseCursor);
	mockFetchChatMessages
		.mockResolvedValueOnce([
			message({ entityId: "invalid-1", username: "", timestamp: new Date(baseCursor + 1_000).toISOString() }),
			message({ entityId: "invalid-2", username: "", timestamp: new Date(baseCursor + 2_000).toISOString() }),
		])
		.mockRejectedValueOnce(new Error("second page failed"));

	const result = await pollChatMessages(DB, { ...CONFIG, pollLimit: 2 });

	assert(result.outcome === "failed");
	expect(result.failure).toEqual({ phase: "catch_up", message: "second page failed" });
	expect(result.cursorPersisted).toBe(false);
	expect(result.cursorTs).toBe(baseCursor);
	expect(mockInsertMessages).not.toHaveBeenCalled();
	expect(mockSetCursor).not.toHaveBeenCalled();
});

it("reports outcome partial with phase gap when a full page follows a request that carried since", async () => {
	const baseCursor = 1_000_000_000_000;
	const firstTs = baseCursor + 10_000;
	const secondTs = firstTs + 10_000;
	mockGetCursor.mockResolvedValue(baseCursor);
	mockFetchChatMessages
		.mockResolvedValueOnce([
			message({ entityId: "msg_1", timestamp: new Date(firstTs).toISOString() }),
			message({ entityId: "msg_2", timestamp: new Date(secondTs).toISOString() }),
		])
		.mockResolvedValueOnce([]);
	mockInsertMessages.mockResolvedValue(2);

	const result = await pollChatMessages(DB, { ...CONFIG, pollLimit: 2 });

	// A full page bounded by a `since` is exactly the shape the observed
	// BitJita contract cannot promise is a complete window — rows between
	// `since` and this page's oldest row may be unreachable.
	assert(result.outcome === "partial");
	expect(result.failure.phase).toBe("gap");
	expect(result.cursorPersisted).toBe(true);
	expect(result.cursorTs).toBe(secondTs);
});

it("does not report a gap for a full page on the first-ever poll", async () => {
	const baseTs = 1_000_000_000_000;
	mockGetCursor.mockResolvedValue(null);
	mockFetchChatMessages
		.mockResolvedValueOnce([
			message({ entityId: "msg_1", timestamp: new Date(baseTs).toISOString() }),
			message({ entityId: "msg_2", timestamp: new Date(baseTs + 10_000).toISOString() }),
		])
		.mockResolvedValueOnce([]);
	mockInsertMessages.mockResolvedValue(2);

	const result = await pollChatMessages(DB, { ...CONFIG, pollLimit: 2 });

	// No stored cursor means the first request carries no `since` at all —
	// a full page here is the normal bootstrap tail, not evidence of a gap.
	expect(result.outcome).toBe("complete");
});

it("reports outcome failed with phase corrupt_cursor when the stored cursor is not a timestamp", async () => {
	mockGetCursor.mockRejectedValue(new CorruptCursorError("chat_firehose", "not-a-number"));

	const result = await pollChatMessages(DB, CONFIG);

	assert(result.outcome === "failed");
	expect(result.failure.phase).toBe("corrupt_cursor");
	expect(result.cursorTs).toBeNull();
	expect(mockFetchChatMessages).not.toHaveBeenCalled();
});
