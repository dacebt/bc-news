import { expect, test } from "vitest";
import { formatEvalCliFailure } from "../src/cli";
import { parseEvalCliCommand } from "../src/cli-options";

test("routes longitudinal build and show", () => {
	expect(parseEvalCliCommand(["longitudinal", "build", "--input", "longitudinal-input.json"])).toEqual({ command: "longitudinal-build", inputPath: "longitudinal-input.json" });
	expect(parseEvalCliCommand(["longitudinal", "show", "series-one", "--results-dir", "series"])).toEqual({ command: "longitudinal-show", seriesId: "series-one", resultsDirectory: "series" });
	expect(formatEvalCliFailure(["longitudinal", "show", "series-one"], new Error("controlled failure"))).toBe("longitudinal scorecard failed: controlled failure");
});
