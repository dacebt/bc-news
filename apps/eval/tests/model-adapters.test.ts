import { expect, test } from "vitest";
import { CloudflareAiGatewayDeterministicError } from "@bc-news/model-adapters";
import { resolveModelProvider } from "../src/model-adapters";

const config = {
	adapter: "cloudflare_ai_gateway" as const,
	model: "openai/gpt-4o-mini" as const,
};

test("resolves the Gateway adapter from the Node evaluation environment", () => {
	expect(resolveModelProvider("main_story_write", config, {
		CF_ACCOUNT_ID: "account-id",
		CF_AI_GATEWAY_API_TOKEN: "sentinel",
	})).toBeDefined();
});

test("rejects missing Gateway evaluation credentials deterministically", () => {
	expect(() => resolveModelProvider("main_story_write", config, {
		CF_ACCOUNT_ID: "account-id",
	})).toThrow(CloudflareAiGatewayDeterministicError);
});
