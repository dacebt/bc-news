import { expect, test } from "vitest";
import { PRODUCTION_MODEL_STEPS } from "@bc-news/generation-core";
import {
	CONTEXT_BENCHMARK_LOADS,
	ContextBenchmarkFileSchema,
	ContextBenchmarkFileV2Schema,
	LegacyContextBenchmarkFileSchema,
	type ContextBenchmarkFile,
	type ContextBenchmarkFileV2,
} from "../src/context-benchmark-file";
import { formatContextBenchmarkReport } from "../src/context-benchmark-report";

const HASH = "a".repeat(64);

function validReport(): ContextBenchmarkFile {
	return ContextBenchmarkFileSchema.parse({
		id: "context-test",
		fixture: {
			path: "packages/fixtures/evidence/active-region-7_2026-01-24.json",
			fixture_sha256: HASH,
			prepared_message_ceiling: 208,
		},
		loads: CONTEXT_BENCHMARK_LOADS,
		model: {
			identifier: "qwen3-local",
			model_key: "qwen3-local-key",
			path: "lmstudio-community/qwen3-local",
			display_name: "Qwen 3 Local",
			context_length: 1_000,
			measurement_runtime: "lmstudio_sdk_1.5",
		},
		rows: CONTEXT_BENCHMARK_LOADS.flatMap((messageLoad) =>
			PRODUCTION_MODEL_STEPS.map((productionStep) => ({
				message_load: messageLoad,
				production_step: productionStep,
				prompt_sha256: HASH,
				request_sha256: HASH,
				structured_output: {
					name: `${productionStep}_output`,
					schema_sha256: HASH,
					enforcement: "lmstudio_json_schema",
				},
				fixed_input_tokens: 10,
				evidence_or_draft_tokens: 10,
				runtime_delta_tokens: 0,
				input_tokens: 20,
				completion_tokens: 10,
				total_tokens: 30,
				context_headroom_tokens: 970,
				completion_bytes: 20,
			})),
		),
		started_at: "2026-08-06T12:00:00.000Z",
		completed_at: "2026-08-06T12:01:00.000Z",
	});
}

function validV2Report(posture: "provider_default" | "explicit"): ContextBenchmarkFileV2 {
	const legacy = validReport();
	if ("version" in legacy) throw new Error("Expected a legacy context result");
	const sampling = posture === "provider_default"
		? { adapter: "lmstudio", posture: "provider_default" } as const
		: {
			adapter: "lmstudio",
			posture: "explicit",
			config: { temperature: 0, top_p: 1, top_k: 40 },
		} as const;
	return ContextBenchmarkFileV2Schema.parse({
		version: 2,
		...legacy,
		sampling: {
			main_story_write: sampling,
			main_story_copyedit: sampling,
			announcements_write: sampling,
			announcements_copyedit: sampling,
		},
	});
}

test("parses an unchanged absent-version context result as strict legacy evidence", () => {
	const report = validReport();

	expect("version" in report).toBe(false);
	expect(LegacyContextBenchmarkFileSchema.safeParse(report).success).toBe(true);
	expect(LegacyContextBenchmarkFileSchema.safeParse({ ...report, sampling: {} }).success).toBe(false);
});

test.each(["provider_default", "explicit"] as const)(
	"parses strict version 2 %s sampling evidence for every production step",
	(posture) => {
		const report = validV2Report(posture);

		expect(report.version).toBe(2);
		expect(Object.keys(report.sampling)).toEqual(PRODUCTION_MODEL_STEPS);
		expect(report.sampling.main_story_write).toEqual(posture === "provider_default"
			? { adapter: "lmstudio", posture: "provider_default" }
			: {
				adapter: "lmstudio",
				posture: "explicit",
				config: { temperature: 0, top_p: 1, top_k: 40 },
			});
	},
);

test("rejects incomplete or contradictory version 2 sampling evidence", () => {
	const explicit = validV2Report("explicit");
	const missingTopK = {
		...explicit,
		sampling: {
			...explicit.sampling,
			main_story_write: {
				adapter: "lmstudio",
				posture: "explicit",
				config: { temperature: 0, top_p: 1 },
			},
		},
	};
	const providerDefault = validV2Report("provider_default");
	const inventedTuple = {
		...providerDefault,
		sampling: {
			...providerDefault.sampling,
			main_story_write: {
				adapter: "lmstudio",
				posture: "provider_default",
				config: { temperature: 0, top_p: 1, top_k: 40 },
			},
		},
	};

	expect(ContextBenchmarkFileV2Schema.safeParse(missingTopK).success).toBe(false);
	expect(ContextBenchmarkFileV2Schema.safeParse(inventedTuple).success).toBe(false);
});

test("rejects mixed LM Studio sampling postures in one version 2 result", () => {
	const report = validV2Report("provider_default");
	const mixedPosture = {
		...report,
		sampling: {
			...report.sampling,
			main_story_write: {
				adapter: "lmstudio",
				posture: "explicit",
				config: { temperature: 0, top_p: 1, top_k: 40 },
			},
		},
	};

	const parsed = ContextBenchmarkFileV2Schema.safeParse(mixedPosture);

	expect(parsed.success).toBe(false);
	if (!parsed.success) {
		expect(parsed.error.issues).toEqual(expect.arrayContaining([
			expect.objectContaining({
				path: ["sampling"],
				message: "all LM Studio production steps must retain one sampling posture",
			}),
		]));
	}
});

test("enforces the frozen inclusive LM Studio tuple bounds", () => {
	const report = validV2Report("explicit");
	const atInclusiveBounds = {
		...report,
		sampling: {
			...report.sampling,
			main_story_write: {
				adapter: "lmstudio",
				posture: "explicit",
				config: { temperature: 2, top_p: 0, top_k: 0 },
			},
		},
	};
	const outsideBounds = {
		...atInclusiveBounds,
		sampling: {
			...atInclusiveBounds.sampling,
			main_story_write: {
				...atInclusiveBounds.sampling.main_story_write,
				config: { temperature: 2.01, top_p: 0, top_k: 0 },
			},
		},
	};

	expect(ContextBenchmarkFileV2Schema.safeParse(atInclusiveBounds).success).toBe(true);
	expect(ContextBenchmarkFileV2Schema.safeParse(outsideBounds).success).toBe(false);
});

test("reports version 2 sampling posture and exact tuple before measurement rows", () => {
	const providerDefault = formatContextBenchmarkReport(validV2Report("provider_default"), "context.json");
	const explicit = formatContextBenchmarkReport(validV2Report("explicit"), "context.json");

	expect(providerDefault).toContain("Sampling:\n  main_story_write: provider_default");
	expect(explicit).toContain(
		"Sampling:\n  main_story_write: explicit (temperature=0, top_p=1, top_k=40)",
	);
	expect(explicit.indexOf("Sampling:")).toBeLessThan(explicit.indexOf(" load  production step"));
});

test("rejects rows outside the exact load and production-step order", () => {
	const report = validReport();
	const rows = [...report.rows];
	[rows[0], rows[1]] = [rows[1]!, rows[0]!];

	const parsed = ContextBenchmarkFileSchema.safeParse({ ...report, rows });

	expect(parsed.success).toBe(false);
	if (!parsed.success) {
		expect(parsed.error.issues).toEqual(expect.arrayContaining([
			expect.objectContaining({ path: ["rows"], message: "rows must match the exact load and production-step order" }),
		]));
	}
});

test("rejects token component arithmetic that does not equal reported input usage", () => {
	const report = validReport();
	const rows = report.rows.map((row, index) => index === 0 ? { ...row, runtime_delta_tokens: 1 } : row);

	const parsed = ContextBenchmarkFileSchema.safeParse({ ...report, rows });

	expect(parsed.success).toBe(false);
	if (!parsed.success) {
		expect(parsed.error.issues).toEqual(expect.arrayContaining([
			expect.objectContaining({ path: ["rows", 0, "input_tokens"], message: "input components must sum exactly" }),
		]));
	}
});

test("rejects total and context-headroom arithmetic drift", () => {
	const report = validReport();
	const rows = report.rows.map((row, index) => index === 0 ? { ...row, context_headroom_tokens: 969 } : row);

	const parsed = ContextBenchmarkFileSchema.safeParse({ ...report, rows });

	expect(parsed.success).toBe(false);
	if (!parsed.success) {
		expect(parsed.error.issues).toEqual(expect.arrayContaining([
			expect.objectContaining({
				path: ["rows", 0, "context_headroom_tokens"],
				message: "total plus headroom must equal the loaded context length",
			}),
		]));
	}
});
