import { expect, test } from "vitest";
import { parseEvalCliCommand } from "../src/cli-options";
import { EVAL_CLI_USAGE, formatEvalCliFailure } from "../src/cli";

test("parses every verification ownership route", () => {
	expect(parseEvalCliCommand(["benchmark", "run", "--fixture", "fixture.json", "--config", "models.json"])).toEqual({
		command: "benchmark-run",
		fixturePath: "fixture.json",
		configPath: "models.json",
	});
	expect(parseEvalCliCommand(["benchmark", "list", "--results-dir", "runs"])).toEqual({ command: "benchmark-list", resultsDirectory: "runs" });
	expect(parseEvalCliCommand(["benchmark", "show", "benchmark-a", "--results-dir", "runs"])).toEqual({ command: "benchmark-show", runId: "benchmark-a", resultsDirectory: "runs" });
	expect(parseEvalCliCommand(["benchmark", "summary", "benchmark-a", "--results-dir", "runs"])).toEqual({ command: "benchmark-summary", runId: "benchmark-a", resultsDirectory: "runs" });
	expect(parseEvalCliCommand(["benchmark", "compare", "benchmark-a", "benchmark-b", "--results-dir", "runs"])).toEqual({ command: "benchmark-compare", leftRunId: "benchmark-a", rightRunId: "benchmark-b", resultsDirectory: "runs" });
	expect(parseEvalCliCommand(["acceptance", "run", "--fixture", "fixture.json"])).toEqual({ command: "acceptance-run", fixturePath: "fixture.json" });
	expect(parseEvalCliCommand(["acceptance", "list", "--results-dir", "runs"])).toEqual({ command: "acceptance-list", resultsDirectory: "runs" });
	expect(parseEvalCliCommand(["acceptance", "show", "run-a", "--results-dir", "runs"])).toEqual({ command: "acceptance-show", runId: "run-a", resultsDirectory: "runs" });
	expect(parseEvalCliCommand(["acceptance", "compare", "run-a", "run-b", "--results-dir", "runs"])).toEqual({ command: "acceptance-compare", leftRunId: "run-a", rightRunId: "run-b", resultsDirectory: "runs" });
	expect(parseEvalCliCommand(["fixture", "record-responses", "--fixture", "fixture.json", "--config", "models.json"])).toEqual({
		command: "fixture-record-responses",
		fixturePath: "fixture.json",
		configPath: "models.json",
	});
	expect(parseEvalCliCommand(["context", "benchmark", "--fixture", "fixture.json"])).toEqual({ command: "context-benchmark", fixturePath: "fixture.json" });
});

test("keeps options with their owning namespace", () => {
	expect(parseEvalCliCommand(["benchmark", "run", "--fixture", "fixture.json", "--config", "models.json", "--results-dir", "benchmarks"])).toMatchObject({ resultsDirectory: "benchmarks" });
	expect(parseEvalCliCommand(["acceptance", "run", "--fixture", "fixture.json", "--config", "recorded.json", "--results-dir", "acceptance"])).toMatchObject({ configPath: "recorded.json", resultsDirectory: "acceptance" });
	expect(parseEvalCliCommand(["fixture", "record-responses", "--fixture", "fixture.json", "--config", "models.json", "--response-dir", "responses"])).toMatchObject({ responseDirectory: "responses" });
	expect(parseEvalCliCommand(["context", "benchmark", "--fixture", "fixture.json", "--results-dir", "contexts"])).toMatchObject({ resultsDirectory: "contexts" });
	expect(() => parseEvalCliCommand(["benchmark", "list", "--response-dir", "responses"])).toThrow("--response-dir is not valid for the benchmark list command");
	expect(() => parseEvalCliCommand(["acceptance", "list", "--config", "recorded.json"])).toThrow("--config is not valid for the acceptance list command");
	expect(() => parseEvalCliCommand(["fixture", "record-responses", "--fixture", "fixture.json", "--config", "models.json", "--results-dir", "results"])).toThrow("--results-dir is not valid for the fixture record-responses command");
	expect(() => parseEvalCliCommand(["context", "benchmark", "--fixture", "fixture.json", "--config", "models.json"])).toThrow("--config is not valid for the context benchmark command");
});

test("rejects every removed bare route and omits it from help", () => {
	for (const route of ["evaluate", "run", "record", "context", "list", "show", "compare"]) {
		expect(() => parseEvalCliCommand([route])).toThrow();
	}
	for (const bareInvocation of [
		"eval -- evaluate ",
		"eval -- run ",
		"eval -- record ",
		"eval -- context --",
		"eval -- list",
		"eval -- show ",
		"eval -- compare ",
	]) {
		expect(EVAL_CLI_USAGE).not.toContain(bareInvocation);
	}
});

test("formats failures through the recognized verification namespace", () => {
	expect(formatEvalCliFailure(["benchmark", "unknown"], new Error("bad route"))).toBe("benchmark failed: bad route");
	expect(formatEvalCliFailure(["acceptance", "unknown"], new Error("bad route"))).toBe("acceptance failed: bad route");
	expect(formatEvalCliFailure(["fixture", "unknown"], new Error("bad route"))).toBe("fixture authoring failed: bad route");
	expect(formatEvalCliFailure(["context", "unknown"], new Error("bad route"))).toBe("context benchmark failed: bad route");
	expect(formatEvalCliFailure(["unknown"], new Error("bad route"))).toBe("command failed: bad route");
});
