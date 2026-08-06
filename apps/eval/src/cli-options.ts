import { parseArgs } from "node:util";
import { validateRunId } from "./run-file";

/**
 * `resultsDirectory` is `undefined` (not a string default) when `--results-dir`
 * is absent: the app-relative default lives in cli.ts, alongside the
 * app-relative `--config` default, because only the caller knows the app
 * directory -- this module resolves flags, not paths.
 */
export type EvalCliCommand =
	| { command: "run"; fixturePath: string; configPath?: string; resultsDirectory?: string }
	| { command: "context"; fixturePath: string; resultsDirectory?: string }
	| { command: "list"; resultsDirectory?: string }
	| { command: "show"; runId: string; resultsDirectory?: string }
	| { command: "compare"; leftRunId: string; rightRunId: string; resultsDirectory?: string };

const ALL_OPTIONS = ["fixture", "config", "results-dir"] as const;

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
		},
	});
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

	const command = positionals[0];
	if (command === "run") {
		exactPositionals(positionals, 1, command);
		rejectUnknownOptions(values, ["fixture", "config", "results-dir"], command);
		if (values.fixture === undefined) throw new CliOptionsError("--fixture is required");
		return {
			command,
			fixturePath: values.fixture,
			...(values.config === undefined ? {} : { configPath: values.config }),
			...(values["results-dir"] === undefined ? {} : { resultsDirectory: values["results-dir"] }),
		};
	}
	if (command === "context") {
		exactPositionals(positionals, 1, command);
		rejectUnknownOptions(values, ["fixture", "results-dir"], command);
		if (values.fixture === undefined) throw new CliOptionsError("--fixture is required");
		return {
			command,
			fixturePath: values.fixture,
			...(values["results-dir"] === undefined ? {} : { resultsDirectory: values["results-dir"] }),
		};
	}
	if (command === "list") {
		exactPositionals(positionals, 1, command);
		rejectUnknownOptions(values, ["results-dir"], command);
		return {
			command,
			...(values["results-dir"] === undefined ? {} : { resultsDirectory: values["results-dir"] }),
		};
	}
	if (command === "show") {
		exactPositionals(positionals, 2, command);
		rejectUnknownOptions(values, ["results-dir"], command);
		return {
			command,
			runId: validateRunId(positionals[1] ?? ""),
			...(values["results-dir"] === undefined ? {} : { resultsDirectory: values["results-dir"] }),
		};
	}
	if (command === "compare") {
		exactPositionals(positionals, 3, command);
		rejectUnknownOptions(values, ["results-dir"], command);
		return {
			command,
			leftRunId: validateRunId(positionals[1] ?? ""),
			rightRunId: validateRunId(positionals[2] ?? ""),
			...(values["results-dir"] === undefined ? {} : { resultsDirectory: values["results-dir"] }),
		};
	}
	throw new CliOptionsError("Expected the run, context, list, show, or compare command");
}
