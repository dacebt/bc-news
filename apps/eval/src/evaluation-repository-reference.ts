import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

const execFileAsync = promisify(execFile);
const COMMIT_SHA = /^[0-9a-f]{40}$/u;

export const RepositoryPathSchema = z.string().min(1).refine((value) => {
	if (value.startsWith("/") || value.includes("\\")) return false;
	const segments = value.split("/");
	return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}, "Path must be a contained POSIX repository-relative path");

export const RepositorySourceReferenceSchema = z.strictObject({
	repository: z.literal("bc-news"),
	commit_sha: z.string().regex(COMMIT_SHA),
	path: RepositoryPathSchema,
});

export type RepositorySourceReference = z.infer<typeof RepositorySourceReferenceSchema>;

export type EvaluationFreshness =
	| { readonly state: "current"; readonly evaluated_commit_sha: string; readonly checkout_commit_sha: string }
	| { readonly state: "outdated"; readonly evaluated_commit_sha: string; readonly checkout_commit_sha: string };

export class EvaluationRepositoryReferenceError extends Error {
	readonly code: "repository_unavailable" | "path_escape" | "source_untracked" | "source_unreadable";
	readonly path: string;

	constructor(code: EvaluationRepositoryReferenceError["code"], path: string, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "EvaluationRepositoryReferenceError";
		this.code = code;
		this.path = path;
	}
}

async function git(repositoryRoot: string, args: readonly string[], code: EvaluationRepositoryReferenceError["code"], path: string): Promise<Buffer> {
	try {
		const { stdout } = await execFileAsync("git", ["-C", repositoryRoot, ...args], {
			encoding: "buffer",
			maxBuffer: 64 * 1024 * 1024,
		});
		return stdout;
	} catch (cause) {
		throw new EvaluationRepositoryReferenceError(code, path, `Git could not resolve ${path}`, { cause });
	}
}

export async function resolveEvaluationRepositoryRoot(currentDirectory: string): Promise<string> {
	const candidate = resolve(currentDirectory);
	const output = await git(candidate, ["rev-parse", "--show-toplevel"], "repository_unavailable", candidate);
	return output.toString("utf8").trim();
}

export async function evaluationRepositoryHead(repositoryRoot: string): Promise<string> {
	const output = await git(repositoryRoot, ["rev-parse", "HEAD"], "repository_unavailable", repositoryRoot);
	const commit = output.toString("utf8").trim();
	if (!COMMIT_SHA.test(commit)) throw new EvaluationRepositoryReferenceError("repository_unavailable", repositoryRoot, "Repository HEAD is not a full commit SHA");
	return commit;
}

export async function sourceReferenceAtHead(repositoryRoot: string, sourcePath: string): Promise<RepositorySourceReference> {
	const root = await realpath(resolve(repositoryRoot));
	const absolute = await realpath(resolve(sourcePath)).catch(() => resolve(sourcePath));
	const path = relative(root, absolute).split(sep).join("/");
	const parsedPath = RepositoryPathSchema.safeParse(path);
	if (!parsedPath.success) throw new EvaluationRepositoryReferenceError("path_escape", sourcePath, "Source must be contained inside the repository");
	const commit_sha = await evaluationRepositoryHead(root);
	await readRepositorySource(root, { repository: "bc-news", commit_sha, path: parsedPath.data });
	return { repository: "bc-news", commit_sha, path: parsedPath.data };
}

export async function readRepositorySource(repositoryRoot: string, reference: RepositorySourceReference): Promise<Uint8Array> {
	const parsed = RepositorySourceReferenceSchema.safeParse(reference);
	if (!parsed.success) throw new EvaluationRepositoryReferenceError("path_escape", String(reference.path), "Invalid repository source reference", { cause: parsed.error });
	return git(resolve(repositoryRoot), ["show", `${parsed.data.commit_sha}:${parsed.data.path}`], "source_unreadable", parsed.data.path);
}

export async function listRepositorySources(repositoryRoot: string, reference: RepositorySourceReference): Promise<readonly string[]> {
	const parsed = RepositorySourceReferenceSchema.parse(reference);
	const output = await git(resolve(repositoryRoot), ["ls-tree", "-r", "--name-only", parsed.commit_sha, "--", parsed.path], "source_unreadable", parsed.path);
	return output.toString("utf8").split("\n").filter((path) => path.length > 0);
}

export async function repositorySourceAtLastChange(
	repositoryRoot: string,
	reference: RepositorySourceReference,
	scopePath: string = reference.path,
): Promise<RepositorySourceReference> {
	const parsed = RepositorySourceReferenceSchema.parse(reference);
	const parsedScope = RepositoryPathSchema.safeParse(scopePath);
	if (!parsedScope.success) throw new EvaluationRepositoryReferenceError("path_escape", scopePath, "Invalid repository source scope", { cause: parsedScope.error });
	const output = await git(resolve(repositoryRoot), ["log", "-1", "--format=%H", parsed.commit_sha, "--", parsedScope.data], "source_unreadable", parsedScope.data);
	const commit_sha = output.toString("utf8").trim();
	if (!COMMIT_SHA.test(commit_sha)) throw new EvaluationRepositoryReferenceError("source_untracked", parsedScope.data, "Repository source scope has no committed change");
	const canonical: RepositorySourceReference = { ...parsed, commit_sha };
	await readRepositorySource(repositoryRoot, canonical);
	return canonical;
}

export async function evaluationFreshness(repositoryRoot: string, evaluatedCommitSha: string): Promise<EvaluationFreshness> {
	if (!COMMIT_SHA.test(evaluatedCommitSha)) throw new EvaluationRepositoryReferenceError("source_unreadable", evaluatedCommitSha, "Evaluated commit must be a full commit SHA");
	const checkout_commit_sha = await evaluationRepositoryHead(repositoryRoot);
	return {
		state: checkout_commit_sha === evaluatedCommitSha ? "current" : "outdated",
		evaluated_commit_sha: evaluatedCommitSha,
		checkout_commit_sha,
	};
}
