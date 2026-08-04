import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { fixtureEvidenceInput, recordedModelProvider } from "@bc-news/fixtures";
import { GenerationConfigError, resolveGenerationPorts } from "../src/config";

// worker-configuration.d.ts types EVIDENCE_INPUT/MODEL_CONFIG as literals, so
// rejection tests must deliberately construct invalid env shapes the compiled
// binding could never hold, to exercise the runtime boundary check.
function envWith(overrides: Record<string, unknown>): Env {
	return { ...env, ...overrides };
}

it("valid config resolves the fixture and recorded ports", () => {
	const fixtureEnv = envWith({ EVIDENCE_INPUT: "fixture" });
	const ports = resolveGenerationPorts(fixtureEnv);

	expect(ports.evidenceInput).toBe(fixtureEvidenceInput);
	expect(ports.modelProviders.main_story).toBe(recordedModelProvider);
	expect(ports.modelProviders.announcements).toBe(recordedModelProvider);
	expect(ports.modelProviders.packaging).toBe(recordedModelProvider);
});

it("committed default resolves a d1-backed evidence port, not the fixture", () => {
	const ports = resolveGenerationPorts(env);

	expect(ports.evidenceInput).toBeDefined();
	expect(ports.evidenceInput).not.toBe(fixtureEvidenceInput);
});

it("rejects unknown evidence adapter id", () => {
	const invalidEnv = envWith({ EVIDENCE_INPUT: "d1" });

	expect(() => resolveGenerationPorts(invalidEnv)).toThrow(GenerationConfigError);
});

it("rejects model config that is not valid json", () => {
	const invalidEnv = envWith({ MODEL_CONFIG: "{not json" });

	expect(() => resolveGenerationPorts(invalidEnv)).toThrow(GenerationConfigError);
});

it("rejects model config with an unknown adapter id", () => {
	const invalidEnv = envWith({
		MODEL_CONFIG: JSON.stringify({
			main_story: { adapter: "hosted" },
			announcements: { adapter: "recorded" },
			packaging: { adapter: "recorded" },
		}),
	});

	expect(() => resolveGenerationPorts(invalidEnv)).toThrow(GenerationConfigError);
});

it("requires LM Studio base URL when any capability selects the adapter", () => {
	const invalidEnv = envWith({
		MODEL_CONFIG: JSON.stringify({
			main_story: { adapter: "lmstudio", model: "local-main" },
			announcements: { adapter: "recorded" },
			packaging: { adapter: "recorded" },
		}),
	});

	expect(() => resolveGenerationPorts(invalidEnv)).toThrow(GenerationConfigError);
});

it("rejects LM Studio config without a model", () => {
	const invalidEnv = envWith({
		LMSTUDIO_BASE_URL: "http://127.0.0.1:1234/v1",
		MODEL_CONFIG: JSON.stringify({
			main_story: { adapter: "lmstudio" },
			announcements: { adapter: "recorded" },
			packaging: { adapter: "recorded" },
		}),
	});

	expect(() => resolveGenerationPorts(invalidEnv)).toThrow(GenerationConfigError);
});

it("rejects LM Studio config with a whitespace-only model", () => {
	const invalidEnv = envWith({
		LMSTUDIO_BASE_URL: "http://127.0.0.1:1234/v1",
		MODEL_CONFIG: JSON.stringify({
			main_story: { adapter: "lmstudio", model: " \t " },
			announcements: { adapter: "recorded" },
			packaging: { adapter: "recorded" },
		}),
	});

	expect(() => resolveGenerationPorts(invalidEnv)).toThrow(GenerationConfigError);
});

it("rejects invalid LM Studio base URL", () => {
	const invalidEnv = envWith({
		LMSTUDIO_BASE_URL: "file:///tmp/lmstudio",
		MODEL_CONFIG: JSON.stringify({
			main_story: { adapter: "lmstudio", model: "local-main" },
			announcements: { adapter: "recorded" },
			packaging: { adapter: "recorded" },
		}),
	});

	expect(() => resolveGenerationPorts(invalidEnv)).toThrow(GenerationConfigError);
});

it("rejects missing announcements key", () => {
	const invalidEnv = envWith({
		MODEL_CONFIG: JSON.stringify({
			main_story: { adapter: "recorded" },
			packaging: { adapter: "recorded" },
		}),
	});

	expect(() => resolveGenerationPorts(invalidEnv)).toThrow(GenerationConfigError);
});

it("rejects missing packaging key", () => {
	const invalidEnv = envWith({
		MODEL_CONFIG: JSON.stringify({
			main_story: { adapter: "recorded" },
			announcements: { adapter: "recorded" },
		}),
	});

	expect(() => resolveGenerationPorts(invalidEnv)).toThrow(GenerationConfigError);
});

it("rejects model config with an extra capability key", () => {
	const invalidEnv = envWith({
		MODEL_CONFIG: JSON.stringify({
			main_story: { adapter: "recorded" },
			announcements: { adapter: "recorded" },
			packaging: { adapter: "recorded" },
			side_story: { adapter: "recorded" },
		}),
	});

	expect(() => resolveGenerationPorts(invalidEnv)).toThrow(GenerationConfigError);
});

it("thrown config errors carry the invalid generation config code", () => {
	const invalidEnv = envWith({ EVIDENCE_INPUT: "d1" });

	try {
		resolveGenerationPorts(invalidEnv);
		expect.unreachable("resolveGenerationPorts should have thrown");
	} catch (error) {
		expect(error).toBeInstanceOf(GenerationConfigError);
		expect((error as GenerationConfigError).code).toBe("invalid_generation_config");
	}
});
