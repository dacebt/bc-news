import { expect, test } from "vitest";
import { formatEvalCliFailure } from "../src/cli";
import { parseEvalCliCommand } from "../src/cli-options";

test("routes scorecard build and show", () => {
	expect(parseEvalCliCommand(["scorecard", "build", "--input", "scorecard-input.json"])).toEqual({ command: "scorecard-build", inputPath: "scorecard-input.json" });
	expect(parseEvalCliCommand(["scorecard", "show", "scorecard-one", "--results-dir", "scorecards"])).toEqual({ command: "scorecard-show", scorecardId: "scorecard-one", resultsDirectory: "scorecards" });
	expect(formatEvalCliFailure(["scorecard", "show", "scorecard-one"], new Error("controlled failure"))).toBe("scorecard failed: controlled failure");
});
