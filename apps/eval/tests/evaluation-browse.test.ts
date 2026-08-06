import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { verifyEvaluationBenchmarkBrowsing } from "../src/evaluation-browse-verifier";
import { summarizeBenchmarkRun } from "../src/evaluation-browse-report";
import { listBenchmarkRuns, loadBenchmarkRun } from "../src/evaluation-artifact-reader";
import { controlledEvaluation, temporaryRoot } from "./evaluation-artifact-test-support";

const RESPONSE_DIRECTORY = new URL("../../../packages/fixtures/model-responses/", import.meta.url).pathname;

async function finalProductRejectedMainStory(): Promise<string> {
	const retained = JSON.parse(
		await readFile(join(RESPONSE_DIRECTORY, "main_story_copyedit.json"), "utf8"),
	) as { text: string };
	const output = JSON.parse(retained.text) as {
		main_story: { body: string };
	};
	output.main_story.body = `${output.main_story.body} system prompt`;
	return JSON.stringify(output);
}

test("browses retained benchmark evidence through the CLI boundary", async () => {
	await verifyEvaluationBenchmarkBrowsing();
});

test("distinguishes an absent benchmark directory from a missing run", async () => {
	const root = await temporaryRoot("bc-news-evaluation-browse-reader-");
	expect(await listBenchmarkRuns(join(root, "absent"))).toEqual([]);
	await expect(loadBenchmarkRun("missing-run", join(root, "absent"))).rejects.toMatchObject({
		code: "benchmark_not_found",
	});
});

test("summarizes products retained by final-product rejection", async () => {
	const { result } = await controlledEvaluation(undefined, 1, {
		main_story_copyedit: await finalProductRejectedMainStory(),
	});
	expect(result.benchmark.trials[0]?.tracks.main_story.subject_outcome).toBe("final_product_rejected");
	const summary = summarizeBenchmarkRun(result.benchmark);
	expect(summary.products).toEqual(expect.arrayContaining([
		expect.objectContaining({ track: "main_story", track_outcome: "final_product_rejected" }),
	]));
});
