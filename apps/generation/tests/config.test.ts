import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { fixtureEvidenceInput, recordedModelProvider } from "@bc-news/fixtures";
import {
	GENERATION_WRITER_STEPS,
	GenerationConfigError,
	resolveGenerationPorts,
} from "../src/config";

function envWith(overrides: Record<string, unknown>): Env {
	return { ...env, ...overrides };
}

function recordedConfig(): Record<string, { adapter: "recorded" }> {
	const config: Record<string, { adapter: "recorded" }> = {};
	for (const step of GENERATION_WRITER_STEPS) {
		config[step] = { adapter: "recorded" };
	}
	return config;
}

it("does not expose operator credentials to the test runtime", () => {
	expect(Reflect.has(env, "CLOUDFLARE_ACCOUNT_ID")).toBe(false);
	expect(Reflect.has(env, "CLOUDFLARE_API_TOKEN")).toBe(false);
});

it("resolves exactly two independently configured writer providers", () => {
	const ports = resolveGenerationPorts(envWith({ EVIDENCE_INPUT: "fixture" }));
	expect(ports.evidenceInput).toBe(fixtureEvidenceInput);
	expect(Object.keys(ports.modelProviders)).toEqual([...GENERATION_WRITER_STEPS]);
	for (const step of GENERATION_WRITER_STEPS) {
		expect(ports.modelProviders[step]).toBe(recordedModelProvider);
	}
});

it("committed default resolves D1 evidence", () => {
	const ports = resolveGenerationPorts(env);
	expect(ports.evidenceInput).toBeDefined();
	expect(ports.evidenceInput).not.toBe(fixtureEvidenceInput);
});

it.each([
	["invalid json", "{not json"],
	["missing writer", JSON.stringify({ main_story_write: { adapter: "recorded" } })],
	["obsolete copyedit key", JSON.stringify({ ...recordedConfig(), main_story_copyedit: { adapter: "recorded" } })],
	["obsolete announcements copyedit key", JSON.stringify({ ...recordedConfig(), announcements_copyedit: { adapter: "recorded" } })],
	["obsolete packaging key", JSON.stringify({ ...recordedConfig(), packaging: { adapter: "recorded" } })],
	["judge key", JSON.stringify({ ...recordedConfig(), judge: { adapter: "recorded" } })],
])("rejects %s before evidence or model work", (_label, modelConfig) => {
	expect(() => resolveGenerationPorts(envWith({ MODEL_CONFIG: modelConfig }))).toThrow(
		GenerationConfigError,
	);
});

it("rejects unknown evidence adapter id", () => {
	expect(() => resolveGenerationPorts(envWith({ EVIDENCE_INPUT: "d1" }))).toThrow(
		GenerationConfigError,
	);
});

it("resolves a hosted provider only with endpoint and API key bindings", () => {
	const hosted = {
		adapter: "openai_compatible_hosted",
		provider: "verify-hosted",
		model: "requested-model",
		billing: {
			method: "calculated",
			input_usd_per_million_tokens: 2,
			output_usd_per_million_tokens: 8,
			pricing_reference: "verify-prices",
		},
	};
	const modelConfig = { ...recordedConfig(), main_story_write: hosted };
	const hostedEnv = envWith({
		HOSTED_MODEL_BASE_URL: "http://127.0.0.1:7777/v1",
		HOSTED_MODEL_API_KEY: "sentinel",
		MODEL_CONFIG: JSON.stringify(modelConfig),
	});
	expect(resolveGenerationPorts(hostedEnv).modelProviders.main_story_write).toBeDefined();
	expect(() =>
		resolveGenerationPorts(envWith({
			HOSTED_MODEL_BASE_URL: "http://127.0.0.1:7777/v1",
			MODEL_CONFIG: hostedEnv.MODEL_CONFIG,
		})),
	).toThrow(GenerationConfigError);
});

it("resolves Cloudflare AI Gateway only with account and token bindings", () => {
	const gateway = {
		adapter: "cloudflare_ai_gateway",
		model: "openai/gpt-4o-mini",
	};
	const modelConfig = { ...recordedConfig(), main_story_write: gateway };
	const gatewayEnv = envWith({
		CLOUDFLARE_ACCOUNT_ID: "account-id",
		CLOUDFLARE_API_TOKEN: "sentinel",
		MODEL_CONFIG: JSON.stringify(modelConfig),
	});
	expect(resolveGenerationPorts(gatewayEnv).modelProviders.main_story_write).toBeDefined();
	expect(() => resolveGenerationPorts(envWith({
		CLOUDFLARE_ACCOUNT_ID: "account-id",
		CLOUDFLARE_API_TOKEN: "",
		MODEL_CONFIG: gatewayEnv.MODEL_CONFIG,
	}))).toThrow(GenerationConfigError);
});

it("resolves independent provider-default and explicit LM Studio temperatures", () => {
	const local = {
		adapter: "lmstudio",
		model: "local-main",
		reasoning_effort: "provider_default",
	};
	const modelConfig = { ...recordedConfig(), main_story_write: local };
	expect(() => resolveGenerationPorts(envWith({ MODEL_CONFIG: JSON.stringify(modelConfig) }))).toThrow(
		GenerationConfigError,
	);
	expect(() => resolveGenerationPorts(envWith({
		LMSTUDIO_BASE_URL: "file:///tmp/lmstudio",
		MODEL_CONFIG: JSON.stringify(modelConfig),
	}))).toThrow(GenerationConfigError);
	expect(resolveGenerationPorts(envWith({
		LMSTUDIO_BASE_URL: "http://127.0.0.1:1234/v1",
		MODEL_CONFIG: JSON.stringify(modelConfig),
	})).modelProviders.main_story_write).toBeDefined();
	expect(resolveGenerationPorts(envWith({
		LMSTUDIO_BASE_URL: "http://127.0.0.1:1234/v1",
		MODEL_CONFIG: JSON.stringify({
			...recordedConfig(),
			main_story_write: { ...local, temperature: 0.6 },
			announcements_write: { ...local, model: "local-announcements", temperature: 0.2 },
		}),
	})).modelProviders.main_story_write).toBeDefined();
});

it("rejects incomplete LM Studio model, obsolete decoding controls, invalid temperature, and reasoning fields", () => {
	for (const local of [
		{ adapter: "lmstudio", temperature: 0.6, reasoning_effort: "provider_default" },
		{ adapter: "lmstudio", model: " \t ", reasoning_effort: "provider_default" },
		{ adapter: "lmstudio", model: "local", temperature: 2.1, reasoning_effort: "provider_default" },
		{ adapter: "lmstudio", model: "local", sampling: { temperature: 1, top_p: 0.95, top_k: 20 }, reasoning_effort: "provider_default" },
		{ adapter: "lmstudio", model: "local", top_p: 0.95, reasoning_effort: "provider_default" },
		{ adapter: "lmstudio", model: "local", top_k: 20, reasoning_effort: "provider_default" },
		{ adapter: "lmstudio", model: "local" },
		{ adapter: "lmstudio", model: "local", temperature: 0.6, reasoning_effort: "none" },
		{ adapter: "lmstudio", model: "local", temperature: 0.6, reasoning_effort: "maximum" },
	]) {
		expect(() => resolveGenerationPorts(envWith({
			LMSTUDIO_BASE_URL: "http://127.0.0.1:1234/v1",
			MODEL_CONFIG: JSON.stringify({ ...recordedConfig(), main_story_write: local }),
		}))).toThrow(GenerationConfigError);
	}
});

it("config errors expose the stable operator code", () => {
	try {
		resolveGenerationPorts(envWith({ EVIDENCE_INPUT: "d1" }));
		expect.unreachable("resolveGenerationPorts should throw");
	} catch (error) {
		expect(error).toBeInstanceOf(GenerationConfigError);
		expect((error as GenerationConfigError).code).toBe("invalid_generation_config");
	}
});
