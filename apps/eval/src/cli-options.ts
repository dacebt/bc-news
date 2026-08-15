import { parseArgs } from "node:util";
import { EvaluationIdSchema } from "./evaluation-artifact-schemas";
import { validateRunId } from "./run-file";

export type EvalCliCommand =
	| { command: "benchmark-run"; fixturePath: string; configPath: string; resultsDirectory?: string }
	| { command: "benchmark-list"; resultsDirectory?: string }
	| { command: "benchmark-show"; runId: string; resultsDirectory?: string }
	| { command: "benchmark-summary"; runId: string; resultsDirectory?: string }
	| { command: "benchmark-compare"; leftRunId: string; rightRunId: string; resultsDirectory?: string }
	| { command: "scratch-run"; fixturePath: string; configPath: string; resultsDirectory: string }
	| { command: "acceptance-run"; fixturePath: string; configPath?: string; resultsDirectory?: string }
	| { command: "acceptance-list"; resultsDirectory?: string }
	| { command: "acceptance-show"; runId: string; resultsDirectory?: string }
	| { command: "acceptance-compare"; leftRunId: string; rightRunId: string; resultsDirectory?: string }
	| { command: "fixture-record-responses"; fixturePath: string; configPath: string; responseDirectory?: string }
	| { command: "context-benchmark"; fixturePath: string; resultsDirectory?: string }
	| { command: "corpus-show"; corpusPath: string }
	| { command: "scorecard-build"; inputPath: string; resultsDirectory?: string }
	| { command: "scorecard-show"; scorecardId: string; resultsDirectory?: string }
	| { command: "longitudinal-build"; inputPath: string; resultsDirectory?: string }
	| { command: "longitudinal-show"; seriesId: string; resultsDirectory?: string };

const ALL_OPTIONS = ["fixture", "config", "results-dir", "response-dir", "corpus", "input"] as const;

export class CliOptionsError extends Error {
	readonly code = "invalid_cli_options";

	constructor(message: string) {
		super(message);
		this.name = "CliOptionsError";
	}
}

function rejectUnknownOptions(
	values: Readonly<Record<string, string | boolean | undefined>>,
	allowed: readonly string[],
	command: string,
): void {
	const invalidOption = ALL_OPTIONS.find((name) => values[name] !== undefined && !allowed.includes(name));
	if (invalidOption !== undefined) {
		throw new CliOptionsError(`--${invalidOption} is not valid for the ${command} command`);
	}
}

function exactPositionals(positionals: readonly string[], count: number, command: string): void {
	if (positionals.length !== count) {
		throw new CliOptionsError(`Invalid arguments for the ${command} command`);
	}
}

function runParseArgs(argv: readonly string[]) {
	return parseArgs({
		args: [...argv],
		allowPositionals: true,
		strict: true,
		options: {
			fixture: { type: "string" },
			config: { type: "string" },
			"results-dir": { type: "string" },
			"response-dir": { type: "string" },
			corpus: { type: "string" },
			input: { type: "string" },
		},
	});
}

type ParsedOptionValues = ReturnType<typeof runParseArgs>["values"];

function requireStringOption(value: string | undefined, option: string): string {
	if (value === undefined) throw new CliOptionsError(`--${option} is required`);
	return value;
}

function benchmarkId(value: string): string {
	const parsed = EvaluationIdSchema.safeParse(value);
	if (!parsed.success) throw new CliOptionsError(`Invalid Benchmark Run id: ${value}`);
	return parsed.data;
}

function scorecardId(value: string): string {
	const parsed = EvaluationIdSchema.safeParse(value);
	if (!parsed.success) throw new CliOptionsError(`Invalid evaluation scorecard id: ${value}`);
	return parsed.data;
}

function longitudinalSeriesId(value: string): string {
	const parsed = EvaluationIdSchema.safeParse(value);
	if (!parsed.success) throw new CliOptionsError(`Invalid longitudinal scorecard series id: ${value}`);
	return parsed.data;
}

function optionalResultsDirectory(value: string | undefined): { resultsDirectory?: string } {
	return value === undefined ? {} : { resultsDirectory: value };
}

function parseBenchmarkCommand(
	positionals: readonly string[],
	values: ParsedOptionValues,
): EvalCliCommand {
	const route = positionals[1];
	if (route === "run") {
		exactPositionals(positionals, 2, "benchmark run");
		rejectUnknownOptions(values, ["fixture", "config", "results-dir"], "benchmark run");
		return {
			command: "benchmark-run",
			fixturePath: requireStringOption(values.fixture, "fixture"),
			configPath: requireStringOption(values.config, "config"),
			...optionalResultsDirectory(values["results-dir"]),
		};
	}
	rejectUnknownOptions(values, ["results-dir"], `benchmark ${route ?? ""}`.trim());
	if (route === "list") {
		exactPositionals(positionals, 2, "benchmark list");
		return { command: "benchmark-list", ...optionalResultsDirectory(values["results-dir"]) };
	}
	if (route === "show" || route === "summary") {
		exactPositionals(positionals, 3, `benchmark ${route}`);
		return {
			command: route === "show" ? "benchmark-show" : "benchmark-summary",
			runId: benchmarkId(positionals[2] ?? ""),
			...optionalResultsDirectory(values["results-dir"]),
		};
	}
	if (route === "compare") {
		exactPositionals(positionals, 4, "benchmark compare");
		return {
			command: "benchmark-compare",
			leftRunId: benchmarkId(positionals[2] ?? ""),
			rightRunId: benchmarkId(positionals[3] ?? ""),
			...optionalResultsDirectory(values["results-dir"]),
		};
	}
	throw new CliOptionsError("Expected benchmark run, list, show, summary, or compare");
}

function parseAcceptanceCommand(
	positionals: readonly string[],
	values: ParsedOptionValues,
): EvalCliCommand {
	const route = positionals[1];
	if (route === "run") {
		exactPositionals(positionals, 2, "acceptance run");
		rejectUnknownOptions(values, ["fixture", "config", "results-dir"], "acceptance run");
		return {
			command: "acceptance-run",
			fixturePath: requireStringOption(values.fixture, "fixture"),
			...(values.config === undefined ? {} : { configPath: values.config }),
			...optionalResultsDirectory(values["results-dir"]),
		};
	}
	rejectUnknownOptions(values, ["results-dir"], `acceptance ${route ?? ""}`.trim());
	if (route === "list") {
		exactPositionals(positionals, 2, "acceptance list");
		return { command: "acceptance-list", ...optionalResultsDirectory(values["results-dir"]) };
	}
	if (route === "show") {
		exactPositionals(positionals, 3, "acceptance show");
		return {
			command: "acceptance-show",
			runId: validateRunId(positionals[2] ?? ""),
			...optionalResultsDirectory(values["results-dir"]),
		};
	}
	if (route === "compare") {
		exactPositionals(positionals, 4, "acceptance compare");
		return {
			command: "acceptance-compare",
			leftRunId: validateRunId(positionals[2] ?? ""),
			rightRunId: validateRunId(positionals[3] ?? ""),
			...optionalResultsDirectory(values["results-dir"]),
		};
	}
	throw new CliOptionsError("Expected acceptance run, list, show, or compare");
}

export function parseEvalCliCommand(argv: readonly string[]): EvalCliCommand {
	let parsed: ReturnType<typeof runParseArgs>;
	try {
		parsed = runParseArgs(argv);
	} catch (cause) {
		const detail = cause instanceof Error ? cause.message : String(cause);
		throw new CliOptionsError(`Unrecognized command-line arguments: ${detail}`);
	}
	const { positionals, values } = parsed;
	const namespace = positionals[0];
	if (namespace === "benchmark") return parseBenchmarkCommand(positionals, values);
	if (namespace === "scratch") {
		if (positionals[1] !== "run") throw new CliOptionsError("Expected scratch run");
		exactPositionals(positionals, 2, "scratch run");
		rejectUnknownOptions(values, ["fixture", "config", "results-dir"], "scratch run");
		return {
			command: "scratch-run",
			fixturePath: requireStringOption(values.fixture, "fixture"),
			configPath: requireStringOption(values.config, "config"),
			resultsDirectory: requireStringOption(values["results-dir"], "results-dir"),
		};
	}
	if (namespace === "acceptance") return parseAcceptanceCommand(positionals, values);
	if (namespace === "fixture") {
		if (positionals[1] !== "record-responses") {
			throw new CliOptionsError("Expected fixture record-responses");
		}
		exactPositionals(positionals, 2, "fixture record-responses");
		rejectUnknownOptions(values, ["fixture", "config", "response-dir"], "fixture record-responses");
		return {
			command: "fixture-record-responses",
			fixturePath: requireStringOption(values.fixture, "fixture"),
			configPath: requireStringOption(values.config, "config"),
			...(values["response-dir"] === undefined ? {} : { responseDirectory: values["response-dir"] }),
		};
	}
	if (namespace === "context") {
		if (positionals[1] !== "benchmark") throw new CliOptionsError("Expected context benchmark");
		exactPositionals(positionals, 2, "context benchmark");
		rejectUnknownOptions(values, ["fixture", "results-dir"], "context benchmark");
		return {
			command: "context-benchmark",
			fixturePath: requireStringOption(values.fixture, "fixture"),
			...optionalResultsDirectory(values["results-dir"]),
		};
	}
	if (namespace === "corpus") {
		if (positionals[1] !== "show") throw new CliOptionsError("Expected corpus show");
		exactPositionals(positionals, 2, "corpus show");
		rejectUnknownOptions(values, ["corpus"], "corpus show");
		return { command: "corpus-show", corpusPath: requireStringOption(values.corpus, "corpus") };
	}
	if (namespace === "scorecard") {
		const route = positionals[1];
		if (route === "build") {
			exactPositionals(positionals, 2, "scorecard build");
			rejectUnknownOptions(values, ["input", "results-dir"], "scorecard build");
			return {
				command: "scorecard-build",
				inputPath: requireStringOption(values.input, "input"),
				...optionalResultsDirectory(values["results-dir"]),
			};
		}
		if (route === "show") {
			exactPositionals(positionals, 3, "scorecard show");
			rejectUnknownOptions(values, ["results-dir"], "scorecard show");
			return {
				command: "scorecard-show",
				scorecardId: scorecardId(positionals[2] ?? ""),
				...optionalResultsDirectory(values["results-dir"]),
			};
		}
		throw new CliOptionsError("Expected scorecard build or show");
	}
	if (namespace === "longitudinal") {
		const route = positionals[1];
		if (route === "build") {
			exactPositionals(positionals, 2, "longitudinal build");
			rejectUnknownOptions(values, ["input", "results-dir"], "longitudinal build");
			return {
				command: "longitudinal-build",
				inputPath: requireStringOption(values.input, "input"),
				...optionalResultsDirectory(values["results-dir"]),
			};
		}
		if (route === "show") {
			exactPositionals(positionals, 3, "longitudinal show");
			rejectUnknownOptions(values, ["results-dir"], "longitudinal show");
			return {
				command: "longitudinal-show",
				seriesId: longitudinalSeriesId(positionals[2] ?? ""),
				...optionalResultsDirectory(values["results-dir"]),
			};
		}
		throw new CliOptionsError("Expected longitudinal build or show");
	}
	throw new CliOptionsError("Expected the benchmark, acceptance, fixture, context, corpus, scorecard, or longitudinal namespace");
}
