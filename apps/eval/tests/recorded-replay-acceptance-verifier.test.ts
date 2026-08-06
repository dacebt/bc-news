import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { PRODUCTION_MODEL_STEPS } from "@bc-news/generation-core";
import { assertRecordedReplayAcceptanceGrounding } from "../src/recorded-replay-acceptance-grounding";
import { assertRecordedReplayAcceptanceSemantics } from "../src/recorded-replay-acceptance-semantics";
import { RECORDED_REPLAY_CONFIG_PATH } from "../src/recorded-replay-acceptance-verifier";
import { REPRESENTATIVE_FIXTURE_PATH } from "../src/representative-fixture";
import { compareRuns } from "../src/compare";
import { runCommand } from "../src/run-command";
import { allDifferences } from "../src/run-difference";

test("recorded replay retains the four outputs and recomputed request relations", async () => {
	const { run } = await runCommand({
		fixturePath: REPRESENTATIVE_FIXTURE_PATH,
		configPath: RECORDED_REPLAY_CONFIG_PATH,
		resultsDirectory: await mkdtemp(join(tmpdir(), "bc-news-recorded-replay-")),
		environment: {},
	});

	expect(run.steps.map((step) => step.production_step)).toEqual(PRODUCTION_MODEL_STEPS);
	expect(() => assertRecordedReplayAcceptanceSemantics(run)).not.toThrow();
	await expect(assertRecordedReplayAcceptanceGrounding(run, REPRESENTATIVE_FIXTURE_PATH)).resolves.toBeUndefined();
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
			active_region_id: "7",
			publication_date: "2026-08-05",
			title: "Morning Dispatch",
			subtitle: "What happened overnight",
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
						write: { provider: "left", model: "writer-a" },
						copyedit: { provider: "left", model: "copyeditor-a" },
					},
					announcements: {
						write: { provider: "left", model: "writer-b" },
						copyedit: { provider: "left", model: "copyeditor-b" },
					},
				},
				counts: { raw_count: 10, after_filter_count: 9, after_burst_count: 8, final_count: 7 },
			},
		},
	};
	const right = {
		id: "right",
		steps: [{ production_step: "announcements_copyedit", output: { announcements: [] } }],
		edition: {
			active_region_id: "8",
			publication_date: "2026-08-06",
			title: "Evening Dispatch",
			subtitle: "What happened by dusk",
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
						write: { provider: "right", model: "writer-x" },
						copyedit: { provider: "right", model: "copyeditor-x" },
					},
					announcements: {
						write: { provider: "right", model: "writer-y" },
						copyedit: { provider: "right", model: "copyeditor-y" },
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
			"run.mainStory.subtitle",
			"run.mainStory.title",
		],
	});
});
