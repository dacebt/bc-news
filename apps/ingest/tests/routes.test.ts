import { beforeEach, expect, it, vi } from "vitest";
import { handlePoll } from "../src/routes";

const mockPollChatMessages = vi.fn();

vi.mock("../src/poller", () => ({
	pollChatMessages: (...args: unknown[]) => mockPollChatMessages(...args) as unknown,
}));

const ENV = {
	DB: {} as D1Database,
	POLL_LIMIT: "100",
	POLL_OVERLAP_SECONDS: "10",
	POLL_CURSOR_KEY: "chat_firehose",
	BITJITA_API_BASE: "http://stub.local",
} satisfies Env & { BITJITA_API_BASE: string };

beforeEach(() => {
	vi.resetAllMocks();
});

it("lets an unexpected poller rejection escape", async () => {
	mockPollChatMessages.mockRejectedValue(new Error("unmodeled poll failure"));

	await expect(handlePoll(ENV)).rejects.toThrow("unmodeled poll failure");
});
