import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { parseEvalCliCommand } from "../src/cli-options";
import { verifyEvaluationLongitudinalScorecards } from "../src/evaluation-longitudinal-scorecard-verifier";

test("routes longitudinal build and show while isolating declaration input", () => {
	expect(parseEvalCliCommand(["longitudinal", "build", "--input", "longitudinal-input.json"])).toEqual({
		command: "longitudinal-build",
		inputPath: "longitudinal-input.json",
	});
	expect(parseEvalCliCommand(["longitudinal", "show", "series-one", "--results-dir", "series"])).toEqual({
		command: "longitudinal-show",
		seriesId: "series-one",
		resultsDirectory: "series",
	});
	expect(() => parseEvalCliCommand(["scorecard", "show", "scorecard-one", "--input", "longitudinal-input.json"])).toThrow("--input is not valid");
	expect(() => parseEvalCliCommand(["longitudinal", "show", "bad/id"])).toThrow("Invalid longitudinal scorecard series id");
});

test("reconstructs reports and verifies the controlled longitudinal audit pack", async () => {
	const root = await mkdtemp(join(tmpdir(), "bc-news-longitudinal-scorecard-app-test-"));
	try {
		const auditPackPath = resolve(
			import.meta.dirname,
			"../../../packages/fixtures/evaluation-longitudinal-scorecards/controlled-longitudinal-series.json",
		);
		const report = await verifyEvaluationLongitudinalScorecards(root, auditPackPath);
		expect(report.match(/Longitudinal role:/gu)).toHaveLength(4);
		for (const classification of ["context_changed", "insufficient_evidence", "within_baseline", "potential_drift"]) {
			expect(report).toContain(classification);
		}
		expect(report).toContain("wilson_score");
		expect(report).toContain("strict_observed_range_disjointness");
		expect(report).toContain('"declared_transport_retry_limit"');
		expect(report).toContain('"annotation"');
		expect(report).toContain('"review"');
		expect(report).toContain("raw_signal_proof: input_tokens");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}, 120_000);
