import { NonRetryableError } from "cloudflare:workflows";
import { expect, it } from "vitest";
import {
	LmStudioDeterministicError,
	createLmStudioModelProvider,
	lmStudioNativeBaseUrl,
} from "../src/adapters/lmstudio-model-provider";
import { failNonRetryablyOnDeterministicErrors } from "../src/non-retryable";

const LOCAL_SAMPLING = { temperature: 1, top_p: 0.95, top_k: 20 } as const;

it("uses the shared strict native LM Studio base URL", () => {
	expect(lmStudioNativeBaseUrl("http://127.0.0.1:1234/v1")).toBe("ws://127.0.0.1:1234");
	expect(() => lmStudioNativeBaseUrl("http://127.0.0.1:1234/proxy/v1"))
		.toThrow(LmStudioDeterministicError);
});

it("constructs the production native provider only with provider-default reasoning", () => {
	expect(createLmStudioModelProvider({
		baseUrl: "http://127.0.0.1:1234/v1",
		model: "qwen/qwen3.5-9b",
		sampling: LOCAL_SAMPLING,
		reasoningEffort: "provider_default",
	})).toBeDefined();
});

it("routes native deterministic failures through the Workflow non-retryable boundary", async () => {
	await expect(failNonRetryablyOnDeterministicErrors(() => {
		throw new LmStudioDeterministicError("lmstudio_invalid_config", "invalid native config");
	})).rejects.toBeInstanceOf(NonRetryableError);
});
