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
	const ports = resolveGenerationPorts(env);

	expect(ports.evidenceInput).toBe(fixtureEvidenceInput);
	expect(ports.modelProviders.main_story).toBe(recordedModelProvider);
	expect(ports.modelProviders.announcements).toBe(recordedModelProvider);
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
			main_story: { adapter: "lmstudio" },
			announcements: { adapter: "recorded" },
		}),
	});

	expect(() => resolveGenerationPorts(invalidEnv)).toThrow(GenerationConfigError);
});

it("rejects missing announcements key", () => {
	const invalidEnv = envWith({
		MODEL_CONFIG: JSON.stringify({ main_story: { adapter: "recorded" } }),
	});

	expect(() => resolveGenerationPorts(invalidEnv)).toThrow(GenerationConfigError);
});

it("rejects model config with an extra capability key", () => {
	const invalidEnv = envWith({
		MODEL_CONFIG: JSON.stringify({
			main_story: { adapter: "recorded" },
			announcements: { adapter: "recorded" },
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
