import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import {
	assertCanonicalEvalParity,
	assertCanonicalEvalSemantics,
	CANONICAL_BASELINE_PATH,
} from "../src/canonical-walk-verifier";
import { RunFileSchema, type RunFile } from "../src/run-file";

async function baselineRun(): Promise<RunFile> {
	return RunFileSchema.parse(JSON.parse(await readFile(CANONICAL_BASELINE_PATH, "utf8")));
}

function replaceStep(run: RunFile, index: number, step: RunFile["steps"][number]): RunFile {
	return RunFileSchema.parse({ ...run, steps: run.steps.map((entry, current) => current === index ? step : entry) });
}

test("allows only run identity timestamps and code-version provenance to differ", async () => {
	const baseline = await baselineRun();
	const candidate = RunFileSchema.parse({
		...baseline,
		id: "candidate-run",
		started_at: "2026-08-05T03:00:00.000Z",
		completed_at: "2026-08-05T03:00:01.000Z",
		fingerprint: { ...baseline.fingerprint, code_version: "candidate-code-version" },
	});

	expect(() => assertCanonicalEvalParity(baseline, candidate)).not.toThrow();
});

test.each([
	["config", (run: RunFile) => RunFileSchema.parse({ ...run, config: { ...run.config, judge: null }, steps: run.steps.map((step) => ({ ...step, judge: null })), fingerprint: { ...run.fingerprint, provider_params: { main_story: run.fingerprint.provider_params.main_story, announcements: run.fingerprint.provider_params.announcements, packaging: run.fingerprint.provider_params.packaging } } })],
	["fixture", (run: RunFile) => RunFileSchema.parse({ ...run, fixture: { ...run.fixture, path: "different.json" } })],
	["ordered roster", (run: RunFile) => RunFileSchema.parse({ ...run, steps: [...run.steps].reverse() })],
	["prompt", (run: RunFile) => replaceStep(run, 0, { ...run.steps[0]!, prompt_sha256: "0".repeat(64) })],
	["output", (run: RunFile) => replaceStep(run, 0, { ...run.steps[0]!, output: { changed: true } })],
	["schema result", (run: RunFile) => replaceStep(run, 0, { ...run.steps[0]!, schema_valid: false })],
	["checks", (run: RunFile) => replaceStep(run, 0, { ...run.steps[0]!, checks: [...(run.steps[0]!.checks ?? []), { name: "schema", passed: true, detail: "changed" }] })],
	["capability usage", (run: RunFile) => replaceStep(run, 0, { ...run.steps[0]!, model_usage: { ...run.steps[0]!.model_usage, model: "recorded/changed" } })],
	["judge scores and aggregate", (run: RunFile) => replaceStep(run, 0, { ...run.steps[0]!, judge: { ...run.steps[0]!.judge!, scores: { grounding: 4, voice: 4, structure: 4 }, aggregate: 4 } })],
	["judge reasoning", (run: RunFile) => replaceStep(run, 0, { ...run.steps[0]!, judge: { ...run.steps[0]!.judge!, reasoning: "Changed reasoning." } })],
	["judge provenance", (run: RunFile) => replaceStep(run, 0, { ...run.steps[0]!, judge: { ...run.steps[0]!.judge!, provenance: { ...run.steps[0]!.judge!.provenance, response_sha256: "0".repeat(64) } } })],
	["judge usage", (run: RunFile) => replaceStep(run, 0, { ...run.steps[0]!, judge: { ...run.steps[0]!.judge!, model_usage: { ...run.steps[0]!.judge!.model_usage, model: "recorded/changed" } } })],
	["stable fingerprint", (run: RunFile) => RunFileSchema.parse({ ...run, fingerprint: { ...run.fingerprint, checks_sha256: "0".repeat(64) } })],
])("rejects %s drift", async (_field, mutate) => {
	const baseline = await baselineRun();
	const candidate = mutate(baseline);

	expect(() => assertCanonicalEvalParity(baseline, candidate)).toThrow(/canonical eval replay drifted/);
});

test("rejects judge weighting drift at the strict run boundary", async () => {
	const baseline = await baselineRun();
	const changed: unknown = JSON.parse(
		JSON.stringify(baseline).replace('"weighting":"v1_rubric_weighted_mean"', '"weighting":"unweighted"'),
	);

	expect(() => RunFileSchema.parse(changed)).toThrow();
});

test("rejects a strict run with a red canonical check", async () => {
	const baseline = await baselineRun();
	const checks = baseline.steps[0]!.checks!.map((check) =>
		check.name === "injection" ? { ...check, passed: false } : check
	);
	const candidate = replaceStep(baseline, 0, { ...baseline.steps[0]!, checks });

	expect(() => assertCanonicalEvalSemantics(candidate)).toThrow(/check injection is red/);
});

test("rejects a strict run without judge results", async () => {
	const baseline = await baselineRun();
	const candidate = RunFileSchema.parse({
		...baseline,
		steps: baseline.steps.map((step) => ({ ...step, judge: null })),
	});

	expect(() => assertCanonicalEvalSemantics(candidate)).toThrow(/has no judge result/);
});

test("rejects a strict-valid non-recorded usage provider", async () => {
	const baseline = await baselineRun();
	const candidate = replaceStep(baseline, 0, {
		...baseline.steps[0]!,
		model_usage: {
			...baseline.steps[0]!.model_usage,
			provider: "hosted-sentinel",
		},
	});

	expect(() => assertCanonicalEvalSemantics(candidate)).toThrow(/non-recorded usage semantics/);
});
