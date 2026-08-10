import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { parseEvalCliCommand } from "../src/cli-options";
import { verifyEvaluationScorecards } from "../src/evaluation-scorecard-verifier";

test("routes scorecard build and show while isolating scorecard input", () => {
	expect(parseEvalCliCommand(["scorecard", "build", "--input", "scorecard-input.json"])).toEqual({
		command: "scorecard-build",
		inputPath: "scorecard-input.json",
	});
	expect(parseEvalCliCommand(["scorecard", "show", "scorecard-one", "--results-dir", "scorecards"])).toEqual({
		command: "scorecard-show",
		scorecardId: "scorecard-one",
		resultsDirectory: "scorecards",
	});
	expect(() => parseEvalCliCommand(["benchmark", "list", "--input", "scorecard-input.json"])).toThrow("--input is not valid");
	expect(() => parseEvalCliCommand(["scorecard", "show", "bad/id"])).toThrow("Invalid evaluation scorecard id");
});

test("builds reads reports and rejects the scorecard corruption matrix", async () => {
	const root = await mkdtemp(join(tmpdir(), "bc-news-scorecard-app-test-"));
	try {
		const manifestPath = resolve(import.meta.dirname, "../../../packages/fixtures/evaluation-corpus/manifest.json");
		const report = await verifyEvaluationScorecards(root, manifestPath);
		expect(report.match(/Scorecard role:/gu)).toHaveLength(4);
		expect(report).toContain('"method": "wilson_score"');
		expect(report).toContain('"metric": "application_latency_ms"');
		expect(report).toContain('"sample_unit": "human_reviewed_output"');
		expect(report).toContain("Qualitative reviewer: repository-human-reviewer (human)");
		expect(report).toContain("Qualitative rubric: bc-news-editorial-qualitative v1");
		expect(report).toContain("Annotation protocol: bc-news-output-annotation v1");
		expect(report).toContain("Human annotator: repository-human-annotator (human)");
		expect(report.match(/Ordered annotation evidence:/gu)).toHaveLength(4);
		expect(report).toContain('"attribution_requirement": "required"');
		expect(report).toContain('"attribution": "present"');
		expect(report).toContain('"event_coverage"');
		expect(report).toContain('"announcement_relevance"');
		expect(report).toContain("coherence: internally understandable organization and relationships");
		expect(report).toContain("usefulness: useful source-grounded information for a regional reader");
		expect(report).toContain("newsworthiness: human judgment that included material is worth reporting, without requiring one target angle");
		expect(report).toContain("voice: adherence to the declared in-world straightforward editorial voice");
	} finally { await rm(root, { recursive: true, force: true }); }
}, 60_000);
