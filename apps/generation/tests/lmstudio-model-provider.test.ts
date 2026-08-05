import { NonRetryableError } from "cloudflare:workflows";
import { afterEach, expect, it, vi } from "vitest";
import {
	LmStudioRetryableError,
	createLmStudioModelProvider,
	lmStudioChatCompletionsUrl,
} from "../src/adapters/lmstudio-model-provider";
import { failNonRetryablyOnDeterministicErrors } from "../src/non-retryable";

afterEach(() => {
	vi.restoreAllMocks();
});

it("preserves URL path prefixes when composing the chat completions endpoint", () => {
	expect(lmStudioChatCompletionsUrl("http://127.0.0.1:1234/v1/").href).toBe(
		"http://127.0.0.1:1234/v1/chat/completions",
	);
});

it.each([
	"ftp://localhost/v1",
	"http://user:secret@localhost/v1",
	"http://localhost/v1?mode=test",
	"http://localhost/v1#fragment",
	" http://localhost/v1",
])("rejects invalid LM Studio base URL %s", (baseUrl) => {
	expect(() => lmStudioChatCompletionsUrl(baseUrl)).toThrowError();
});

it("sends OpenAI-compatible auth, model, and messages", async () => {
	const timeoutSignal = new AbortController().signal;
	const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeoutSignal);
	const fetchCall = vi.spyOn(globalThis, "fetch").mockResolvedValue(
		Response.json({ choices: [{ message: { content: "model output" } }] }),
	);
	const provider = createLmStudioModelProvider({
		baseUrl: "http://127.0.0.1:1234/v1",
		model: "local-model",
	});

	await expect(
		provider.complete({
			editorialCapability: "main_story",
			system: "system constraints",
			user: "main story prompt",
		}),
	).resolves.toEqual({
		text: "model output",
		provider: "lmstudio",
		model: "local-model",
		execution: "local_inference",
		token_usage: { measurement: "unavailable" },
		external_billing: { classification: "none", amount_usd: 0, reason: "local_inference" },
	});

	const request = fetchCall.mock.calls[0];
	const requestTarget = request?.[0];
	const requestUrl =
		typeof requestTarget === "string"
			? requestTarget
			: requestTarget instanceof URL
				? requestTarget.href
				: requestTarget?.url;
	expect(requestUrl).toBe("http://127.0.0.1:1234/v1/chat/completions");
	expect(request?.[1]?.headers).toEqual({
		Authorization: "Bearer lmstudio",
		"Content-Type": "application/json",
	});
	const requestBody = request?.[1]?.body;
	if (typeof requestBody !== "string") throw new Error("Expected request body to be JSON text");
	expect(JSON.parse(requestBody) as unknown).toEqual({
		model: "local-model",
		messages: [
			{ role: "system", content: "system constraints" },
			{ role: "user", content: "main story prompt" },
		],
	});
	expect(request?.[1]?.signal).toBeInstanceOf(AbortSignal);
	expect(timeout).toHaveBeenCalledWith(600_000);
});

it.each([
	[429, "rate limit"],
	[500, "server failure"],
])("classifies HTTP %i as retryable", async (status, statusText) => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status, statusText }));
	const provider = createLmStudioModelProvider({ baseUrl: "http://localhost/v1", model: "local" });

	await expect(
		provider.complete({ editorialCapability: "announcements", system: "system", user: "user" }),
	).rejects.toBeInstanceOf(LmStudioRetryableError);
});

it.each([
	[new TypeError("connection refused"), "lmstudio_network_failure"],
	[new DOMException("timed out", "TimeoutError"), "lmstudio_timeout"],
])("classifies transport failure as retryable", async (failure, code) => {
	vi.spyOn(globalThis, "fetch").mockRejectedValue(failure);
	const provider = createLmStudioModelProvider({ baseUrl: "http://localhost/v1", model: "local" });

	await expect(
		provider.complete({ editorialCapability: "packaging", system: "system", user: "user" }),
	).rejects.toMatchObject({ code });
});

it.each([
	new TypeError("connection reset while reading response body"),
	new Error("response body stream failed"),
])("classifies response body transport failure as retryable", async (failure) => {
	const failedBody = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.error(failure);
		},
	});
	vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(failedBody, { status: 200 }));
	const provider = createLmStudioModelProvider({ baseUrl: "http://localhost/v1", model: "local" });

	await expect(
		provider.complete({ editorialCapability: "main_story", system: "system", user: "user" }),
	).rejects.toMatchObject({ code: "lmstudio_network_failure" });
});

it("classifies other HTTP rejections as deterministic", async () => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 400 }));
	const provider = createLmStudioModelProvider({ baseUrl: "http://localhost/v1", model: "local" });

	await expect(
		failNonRetryablyOnDeterministicErrors(() =>
			provider.complete({ editorialCapability: "main_story", system: "system", user: "user" }),
		),
	).rejects.toBeInstanceOf(NonRetryableError);
});

it("rejects malformed JSON non-retryably", async () => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not json", { status: 200 }));
	const provider = createLmStudioModelProvider({ baseUrl: "http://localhost/v1", model: "local" });

	await expect(
		failNonRetryablyOnDeterministicErrors(() =>
			provider.complete({ editorialCapability: "main_story", system: "system", user: "user" }),
		),
	).rejects.toBeInstanceOf(NonRetryableError);
});

it.each([
	Response.json({ choices: [] }),
	Response.json({ choices: [{ message: { content: "" } }] }),
])("rejects malformed completion responses non-retryably", async (response) => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
	const provider = createLmStudioModelProvider({ baseUrl: "http://localhost/v1", model: "local" });

	await expect(
		failNonRetryablyOnDeterministicErrors(() =>
			provider.complete({ editorialCapability: "main_story", system: "system", user: "user" }),
		),
	).rejects.toBeInstanceOf(NonRetryableError);
});

it("maps complete internally consistent token usage", async () => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(
		Response.json({
			choices: [{ message: { content: "model output" } }],
			usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
		}),
	);
	const provider = createLmStudioModelProvider({ baseUrl: "http://localhost/v1", model: "local" });

	await expect(
		provider.complete({ editorialCapability: "main_story", system: "system", user: "user" }),
	).resolves.toMatchObject({
		execution: "local_inference",
		token_usage: { measurement: "reported", input_tokens: 3, output_tokens: 2, total_tokens: 5 },
		external_billing: { classification: "none", amount_usd: 0, reason: "local_inference" },
	});
});

it.each([
	{ prompt_tokens: 1, completion_tokens: 2 },
	{ prompt_tokens: -1, completion_tokens: 2, total_tokens: 1 },
	{ prompt_tokens: 1.5, completion_tokens: 2, total_tokens: 3.5 },
	{ prompt_tokens: 1, completion_tokens: 2, total_tokens: 4 },
])("rejects malformed supplied token usage %# non-retryably", async (usage) => {
	vi.spyOn(globalThis, "fetch").mockResolvedValue(
		Response.json({ choices: [{ message: { content: "model output" } }], usage }),
	);
	const provider = createLmStudioModelProvider({ baseUrl: "http://localhost/v1", model: "local" });

	await expect(
		failNonRetryablyOnDeterministicErrors(() =>
			provider.complete({ editorialCapability: "main_story", system: "system", user: "user" }),
		),
	).rejects.toBeInstanceOf(NonRetryableError);
});
