import { execFile } from "node:child_process";
import { isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type { BenchmarkRun } from "./evaluation-artifact";

const execFileAsync = promisify(execFile);

function excludedResultsPath(workspaceRoot: string, resultsDirectory: string): string | undefined {
	const relativePath = relative(resolve(workspaceRoot), resolve(resultsDirectory));
	if (relativePath === "" || relativePath === ".") throw new EvaluationProvenanceError("The evaluation results directory cannot be the source workspace root");
	if (relativePath === ".." || relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(relativePath)) return undefined;
	return relativePath.replaceAll("\\", "/");
}

export class EvaluationProvenanceError extends Error {
	readonly code = "evaluation_code_provenance_unavailable";
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "EvaluationProvenanceError";
	}
}

export async function codeProvenance(workspaceRoot: string, resultsDirectory: string): Promise<BenchmarkRun["provenance"]["code"]> {
	try {
		const excludedPath = excludedResultsPath(workspaceRoot, resultsDirectory);
		if (excludedPath !== undefined) {
			const { stdout: trackedResults } = await execFileAsync("git", ["ls-files", "-z", "--", excludedPath], { cwd: workspaceRoot, encoding: "buffer", maxBuffer: 10_000_000 });
			if (trackedResults.length > 0) throw new EvaluationProvenanceError(`The evaluation results exclusion would hide tracked source at ${excludedPath}`);
		}
		const diffArguments = ["diff", "HEAD", "--binary", "--no-ext-diff", "--", "."];
		if (excludedPath !== undefined) diffArguments.push(`:(exclude,glob)${excludedPath}/**`);
		const [{ stdout: commitOut }, { stdout: diff }, { stdout: untrackedOut }] = await Promise.all([
			execFileAsync("git", ["rev-parse", "--verify", "HEAD"], { cwd: workspaceRoot, encoding: "utf8", maxBuffer: 10_000_000 }),
			execFileAsync("git", diffArguments, { cwd: workspaceRoot, encoding: "buffer", maxBuffer: 100_000_000 }),
			execFileAsync("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd: workspaceRoot, encoding: "buffer", maxBuffer: 10_000_000 }),
		]);
		const commitSha = commitOut.trim();
		if (!/^[0-9a-f]{40}$/u.test(commitSha)) throw new Error("git returned an invalid commit SHA");
		const untrackedPaths = untrackedOut.toString("utf8").split("\0").filter((path) => path !== "" && (excludedPath === undefined || (path !== excludedPath && !path.startsWith(`${excludedPath}/`)))).sort();
		if (diff.length > 0 || untrackedPaths.length > 0) throw new EvaluationProvenanceError("Live evaluation requires a clean source workspace");
			return {
				repository: "bc-news",
				commit_sha: commitSha,
				dirty: false,
			};
	} catch (cause) {
		if (cause instanceof EvaluationProvenanceError) throw cause;
		throw new EvaluationProvenanceError("Could not establish exact local source provenance before evaluation artifact creation", { cause });
	}
}
