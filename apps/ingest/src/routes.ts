import { IngestConfigError, resolvePollConfig } from "./config";
import { pollChatMessages, type PollResult } from "./poller";

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

// A corrupt cursor and an unreachable BitJita both stop the poll, but they
// call for opposite operator responses — one clears on retry, the other
// won't until a human repairs the row (see poller.ts, chat-store.ts). The
// wire body carries the poller's own failure detail so those cases (and any
// other failure phase) are distinguishable, never collapsed to one shape.
function pollResponseBody(result: PollResult): Record<string, unknown> {
	const body: Record<string, unknown> = {
		outcome: result.outcome,
		inserted_count: result.insertedCount,
		skipped_invalid: result.skippedInvalid,
		cursor_ts: result.cursorTs,
	};
	if (result.outcome !== "complete") {
		body.failure = result.failure;
	}
	return body;
}

export async function handlePoll(env: Env): Promise<Response> {
	let config;
	try {
		config = resolvePollConfig(env);
	} catch (error) {
		if (error instanceof IngestConfigError) {
			// 500, not 502: a rejected env var is this deployment's own
			// misconfiguration, not an upstream dependency failing.
			return jsonResponse(500, { error: "invalid_poll_config", message: error.message });
		}
		throw error;
	}

	let result: PollResult;
	try {
		result = await pollChatMessages(env.DB, config);
	} catch (error) {
		// An exception escaping pollChatMessages is a bug in an unmodeled
		// path, not one of the poller's own recognized failure phases — full
		// detail stays server-side via the platform's own error logging.
		const message = error instanceof Error ? error.message : String(error);
		return jsonResponse(500, { error: "unexpected_poll_error", message });
	}

	const status = result.outcome === "complete" ? 200 : 502;
	return jsonResponse(status, pollResponseBody(result));
}
