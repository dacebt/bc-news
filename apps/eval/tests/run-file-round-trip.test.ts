import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { RunFileSchema, generateRunId, listRunFiles, loadRunFile, saveRunFile, type RunFile } from "../src/run-file";

function hash(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function usage(capability: "main_story" | "announcements" | "packaging") {
	return {
		editorial_capability: capability,
		provider: "recorded",
		model: "recorded-fixture",
		execution: "recorded_replay" as const,
		token_usage: { measurement: "unavailable" as const },
		external_billing: { classification: "none" as const, amount_usd: 0 as const, reason: "recorded_replay" as const },
	};
}

function sampleRun(id: string): RunFile {
	return {
		id,
		config: {
			capabilities: {
				main_story: { adapter: "recorded" },
				announcements: { adapter: "recorded" },
				packaging: { adapter: "recorded" },
			},
			judge: null,
		},
		fixture: { path: "packages/fixtures/evidence/active-region-7_2026-01-24.json", fixture_sha256: hash("fixture") },
		steps: [
			{
				capability: "main_story",
				prompt_sha256: hash("prompt"),
				output: { main_story: { headline: "h", lede: "l", body: "b" } },
				schema_valid: true,
				checks: [{ name: "injection", passed: true, detail: "no injection markers" }],
				model_usage: usage("main_story"),
				judge: null,
			},
			{
				capability: "announcements",
				prompt_sha256: hash("announcements prompt"),
				output: { announcements: [] },
				schema_valid: true,
				checks: [],
				model_usage: usage("announcements"),
				judge: null,
			},
			{
				capability: "packaging",
				prompt_sha256: hash("packaging prompt"),
				output: { title: "t", subtitle: "s" },
				schema_valid: true,
				checks: [],
				model_usage: usage("packaging"),
				judge: null,
			},
		],
		started_at: "2026-01-25T00:00:00.000Z",
		completed_at: "2026-01-25T00:00:01.000Z",
		fingerprint: {
			provider_params: {
				main_story: { provider: "recorded", model: "recorded-fixture" },
				announcements: { provider: "recorded", model: "recorded-fixture" },
				packaging: { provider: "recorded", model: "recorded-fixture" },
			},
			fixture_sha256: hash("fixture"),
			checks_sha256: hash("checks"),
			providers_sha256: hash("providers"),
			rubrics_sha256: hash(""),
			schemas_sha256: hash("schemas"),
			code_version: "deadbeef",
		},
	};
}

async function tempResultsDirectory(): Promise<string> {
	return mkdtemp(join(tmpdir(), "bc-news-eval-"));
}

test("round-trips a strictly-written run through the permissive read schema", async () => {
	const directory = await tempResultsDirectory();
	const run = sampleRun(generateRunId());
	const path = await saveRunFile(run, directory);

	const read = await loadRunFile(run.id, directory);

	expect(read.id).toBe(run.id);
	expect(read.fixture?.fixture_sha256).toBe(run.fixture.fixture_sha256);
	expect(read.steps).toHaveLength(3);
	expect(read.steps[0]?.capability).toBe("main_story");
	expect(read.fingerprint?.code_version).toBe("deadbeef");
	await expect(readFile(path, "utf8")).resolves.toContain(run.id);
});

test("keeps both run files when ids collide", async () => {
	const directory = await tempResultsDirectory();
	const run = sampleRun(generateRunId());
	const firstPath = await saveRunFile(run, directory);
	const firstBytes = await readFile(firstPath, "utf8");

	const secondPath = await saveRunFile(run, directory);

	expect(secondPath).not.toBe(firstPath);
	const second: unknown = JSON.parse(await readFile(secondPath, "utf8"));
	expect((second as { id: string }).id).toBe(`${run.id}-2`);
	await expect(readFile(firstPath, "utf8")).resolves.toBe(firstBytes);
});

test("loads a part-1-shaped run file whose judge steps are plain null", async () => {
	const directory = await tempResultsDirectory();
	// Modeled on results/2026-08-04T16-57-33-530Z.json: no judge shape existed
	// yet, so the step simply carried `judge: null` with no dimension scores.
	const partOneRun = {
		id: "2026-08-04T16-57-33-530Z",
		config: { capabilities: { main_story: { adapter: "recorded" } }, judge: null },
		fixture: { path: "packages/fixtures", fixture_sha256: hash("fixture") },
		steps: [
			{
				capability: "main_story",
				prompt_sha256: hash("prompt"),
				output: { main_story: { headline: "h", lede: "l", body: "b" } },
				schema_valid: true,
				checks: [{ name: "injection", passed: false, detail: "Tone violation: :)" }],
				judge: null,
			},
		],
		started_at: "2026-08-04T16:57:33.520Z",
		completed_at: "2026-08-04T16:57:33.530Z",
		fingerprint: {
			provider_params: { main_story: { provider: "recorded", model: "recorded/main-story-v1" } },
			fixture_sha256: hash("fixture"),
			checks_sha256: hash("checks"),
			providers_sha256: hash("providers"),
			rubrics_sha256: hash(""),
			schemas_sha256: hash("schemas"),
			code_version: "4c7ad2d365e8a75f394129c17da350cdf58cb0a1-dirty-eb98160bf547",
		},
	};
	await writeFile(join(directory, `${partOneRun.id}.json`), `${JSON.stringify(partOneRun)}\n`, {
		encoding: "utf8",
		flag: "wx",
	});

	const read = await loadRunFile(partOneRun.id, directory);

	expect(read.id).toBe(partOneRun.id);
	expect(read.steps[0]?.judge).toBeNull();
});

test("round-trips a judged run carrying strict per-dimension scores and the weighting disposition", async () => {
	const directory = await tempResultsDirectory();
	const run: RunFile = {
		...sampleRun(generateRunId()),
		steps: sampleRun("sample").steps.map((step) => ({
			...step,
			judge: {
				scores: step.capability === "main_story"
					? { grounding: 5, voice: 4, structure: 4 }
					: step.capability === "announcements"
						? { completeness: 5, accuracy: 5, clarity: 4, coverage_quality: 4 }
						: { preservation: 5, accuracy: 5, packaging: 4, metadata: 5 },
				reasoning: "strict capability-specific rubric judgment",
				aggregate: step.capability === "main_story" ? 4.35 : step.capability === "announcements" ? 4.7 : 4.8,
				weighting: "v1_rubric_weighted_mean",
				provenance: {
					source: "recorded_replay",
					prompt_sha256: hash(`judge prompt ${step.capability}`),
					response_sha256: hash(`judge response ${step.capability}`),
				},
				model_usage: usage(step.capability),
			},
		})),
	};

	const path = await saveRunFile(run, directory);
	const read = await loadRunFile(run.id, directory);

	expect(read.id).toBe(run.id);
	const judge = read.steps[0]?.judge as { scores: Record<string, number>; weighting: string } | null;
	expect(judge?.weighting).toBe("v1_rubric_weighted_mean");
	expect(judge?.scores).toEqual({ grounding: 5, voice: 4, structure: 4 });
	await expect(readFile(path, "utf8")).resolves.toContain("v1_rubric_weighted_mean");
});

test("rejects an out-of-range judge score at write time", () => {
	const run = sampleRun(generateRunId());
	const withBadScore = {
		...run,
		steps: [
			{
				...run.steps[0],
				judge: {
					scores: { grounding: 6, voice: 4, structure: 4 },
					reasoning: "x",
					aggregate: 4.67,
					weighting: "v1_rubric_weighted_mean",
					provenance: {
						source: "recorded_replay",
						prompt_sha256: hash("judge prompt"),
						response_sha256: hash("judge response"),
					},
				},
			},
		],
	};

	expect(RunFileSchema.safeParse(withBadScore).success).toBe(false);
});

test("rejects judge dimensions that do not exactly match the capability rubric", () => {
	const run = sampleRun(generateRunId());
	const withDriftedDimensions = {
		...run,
		steps: [{
			...run.steps[0],
			judge: {
				scores: { grounding: 5, voice: 4, structure: 4, invented: 5 },
				reasoning: "x",
				aggregate: 4.35,
				weighting: "v1_rubric_weighted_mean",
				provenance: {
					source: "recorded_replay",
					prompt_sha256: hash("judge prompt"),
					response_sha256: hash("judge response"),
				},
			},
		}],
	};

	expect(RunFileSchema.safeParse(withDriftedDimensions).success).toBe(false);
});

test("rejects a retained aggregate that disagrees with rubric weights", () => {
	const run = sampleRun(generateRunId());
	const withTrustedAggregate = {
		...run,
		steps: [{
			...run.steps[0],
			judge: {
				scores: { grounding: 5, voice: 4, structure: 4 },
				reasoning: "x",
				aggregate: 5,
				weighting: "v1_rubric_weighted_mean",
				provenance: {
					source: "recorded_replay",
					prompt_sha256: hash("judge prompt"),
					response_sha256: hash("judge response"),
				},
			},
		}],
	};

	expect(RunFileSchema.safeParse(withTrustedAggregate).success).toBe(false);
});

test("lists and shows a run file carrying unknown keys the write schema would reject", async () => {
	const directory = await tempResultsDirectory();
	const run = sampleRun(generateRunId());
	const withUnknownKeys = {
		...run,
		future_field: "from a later run-file shape",
		fingerprint: { ...run.fingerprint, future_fingerprint_field: 1 },
	};
	await writeFile(join(directory, `${run.id}.json`), `${JSON.stringify(withUnknownKeys)}\n`, {
		encoding: "utf8",
		flag: "wx",
	});

	const shown = await loadRunFile(run.id, directory);
	expect(shown.id).toBe(run.id);

	const listed = await listRunFiles(directory);
	expect(listed.map((entry) => entry.id)).toContain(run.id);
});
