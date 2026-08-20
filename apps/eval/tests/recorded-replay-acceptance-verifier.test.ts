import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { assertRecordedReplayAcceptanceDeterminism } from "../src/recorded-replay-acceptance-determinism";
import { assertRecordedReplayAcceptanceGrounding } from "../src/recorded-replay-acceptance-grounding";
import { assertRecordedReplayAcceptanceSemantics } from "../src/recorded-replay-acceptance-semantics";
import { RECORDED_REPLAY_CONFIG_PATH } from "../src/recorded-replay-acceptance-verifier";
import { REPRESENTATIVE_FIXTURE_PATH } from "../src/representative-fixture";
import { compareRuns } from "../src/compare";
import { CURRENT_PRODUCTION_MODEL_STEPS } from "../src/current-production-steps";
import { runCommand } from "../src/run-command";
import { allDifferences } from "../src/run-difference";

test("recorded replay retains the two outputs and current product relations", async () => {
	const { run } = await runCommand({
		fixturePath: REPRESENTATIVE_FIXTURE_PATH,
		configPath: RECORDED_REPLAY_CONFIG_PATH,
		resultsDirectory: await mkdtemp(join(tmpdir(), "bc-news-recorded-replay-")),
		environment: {},
	});

	expect(run.steps.map((step) => step.production_step)).toEqual(CURRENT_PRODUCTION_MODEL_STEPS);
	expect(Array.isArray(run.diagnostics)).toBe(true);
	expect(() => assertRecordedReplayAcceptanceSemantics(run)).not.toThrow();
	await expect(assertRecordedReplayAcceptanceGrounding(run, REPRESENTATIVE_FIXTURE_PATH)).resolves.toBeUndefined();
	await expect(assertRecordedReplayAcceptanceGrounding({
		...run,
		diagnostics: [...run.diagnostics, {
			kind: "final_product",
			production_step: "announcements_write",
			code: "forbidden_marker",
			message: "invented retained diagnostic",
		}],
	}, REPRESENTATIVE_FIXTURE_PATH)).rejects.toThrow("diagnostics were not retained exactly");
	expect(() => assertRecordedReplayAcceptanceDeterminism(run, {
		...run,
		diagnostics: [...run.diagnostics, {
			kind: "final_product",
			production_step: "announcements_write",
			code: "forbidden_marker",
			message: "invented deterministic diagnostic",
		}],
	})).toThrow("recorded-replay acceptance is not deterministic");
});

test("difference reporting names every changed product path", () => {
	expect(allDifferences(
		{ title: "A", story: { lede: "B", body: "C" } },
		{ title: "X", story: { lede: "Y", body: "C" } },
	)).toEqual(["run.story.lede", "run.title"]);
});

test("run comparison ignores retained evidence metadata and names final editorial product differences", () => {
	const left = {
		id: "left",
		steps: [{ production_step: "main_story_write", output: { title: "Draft A" } }],
		edition: {
			version: 2,
			active_region_id: "7",
			publication_date: "2026-08-05",
			title: "Morning Dispatch",
			announcements: [{ title: "First milestone", summary: "Built the first hall." }],
			main_story: {
				headline: "A busy morning",
				lede: "The region woke early.",
				body: "Work began before sunrise.",
			},
			meta: {
				generated_at_utc: "2026-08-05T10:00:00.000Z",
				editorial_products: {
					main_story: {
						provider: "left",
						model: "writer-a",
					},
					announcements: {
						provider: "left",
						model: "writer-b",
					},
				},
				counts: { raw_count: 10, after_filter_count: 9, after_burst_count: 8, final_count: 7 },
			},
		},
	};
	const right = {
		id: "right",
		steps: [{ production_step: "announcements_write", output: { announcements: [] } }],
		edition: {
			version: 2,
			active_region_id: "8",
			publication_date: "2026-08-06",
			title: "Evening Dispatch",
			announcements: [{ title: "Second milestone", summary: "Built the second hall." }],
			main_story: {
				headline: "A busy evening",
				lede: "The region worked late.",
				body: "Work continued after sunset.",
			},
			meta: {
				generated_at_utc: "2026-08-06T22:00:00.000Z",
				editorial_products: {
					main_story: {
						provider: "right",
						model: "writer-x",
					},
					announcements: {
						provider: "right",
						model: "writer-y",
					},
				},
				counts: { raw_count: 20, after_filter_count: 19, after_burst_count: 18, final_count: 17 },
			},
		},
	};

	expect(compareRuns(left, right)).toEqual({
		leftId: "left",
		rightId: "right",
		differences: [
			"run.announcements.announcements[0].summary",
			"run.announcements.announcements[0].title",
			"run.mainStory.main_story.body",
			"run.mainStory.main_story.headline",
			"run.mainStory.main_story.lede",
			"run.mainStory.title",
		],
	});
});
