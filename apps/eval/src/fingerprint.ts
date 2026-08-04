import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";

const execFileAsync = promisify(execFile);

const SRC_DIRECTORY = fileURLToPath(new URL(".", import.meta.url));
const PACKAGE_DIRECTORY = resolve(SRC_DIRECTORY, "..");
export const WORKSPACE_ROOT = resolve(SRC_DIRECTORY, "../../..");
const CHECKS_DIRECTORY = join(SRC_DIRECTORY, "checks");
const CONTRACTS_SRC_DIRECTORY = join(WORKSPACE_ROOT, "packages", "contracts", "src");
const GENERATION_CORE_SRC_DIRECTORY = join(WORKSPACE_ROOT, "packages", "generation-core", "src");
const PROVIDERS_PATH = join(SRC_DIRECTORY, "model-adapters.ts");
const RECORDED_MODEL_PROVIDER_PATH = join(
	WORKSPACE_ROOT,
	"packages",
	"fixtures",
	"src",
	"recorded-model-provider.ts",
);
const RECORDED_RESPONSE_PATH = join(
	WORKSPACE_ROOT,
	"packages",
	"fixtures",
	"src",
	"recorded-response.ts",
);
const RECORDED_JUDGE_MODEL_PROVIDER_PATH = join(
	WORKSPACE_ROOT,
	"packages",
	"fixtures",
	"src",
	"recorded-judge-model-provider.ts",
);
const RECORDED_MODEL_RESPONSE_PATH = join(
	WORKSPACE_ROOT,
	"packages",
	"fixtures",
	"model-responses",
	"main_story.json",
);
const RECORDED_JUDGE_RESPONSE_PATH = join(
	WORKSPACE_ROOT,
	"packages",
	"fixtures",
	"model-responses",
	"judge",
	"main_story.json",
);
const RUBRICS_PATH = join(SRC_DIRECTORY, "rubrics.ts");
const JUDGE_PATH = join(SRC_DIRECTORY, "judge.ts");

export const Sha256HashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const ProviderParamEntrySchema = z.strictObject({
	provider: z.string().min(1),
	model: z.string().min(1),
});
export type ProviderParamEntry = z.infer<typeof ProviderParamEntrySchema>;

/**
 * Ported from v1's provider_params, adjusted to what ModelProviderPort
 * actually reports (provider + model), not a requested temperature: our
 * port's complete() result carries no temperature field, so the
 * "reported-effective values" this fingerprint captures are the provider and
 * model that actually served each capability's completion.
 */
export const ProviderParamsSchema = z.strictObject({
	main_story: ProviderParamEntrySchema,
	judge: ProviderParamEntrySchema.optional(),
});
export type ProviderParams = z.infer<typeof ProviderParamsSchema>;

export const RunFingerprintSchema = z.strictObject({
	provider_params: ProviderParamsSchema,
	fixture_sha256: Sha256HashSchema,
	checks_sha256: Sha256HashSchema,
	providers_sha256: Sha256HashSchema,
	rubrics_sha256: Sha256HashSchema,
	schemas_sha256: Sha256HashSchema,
	code_version: z.string().min(1).nullable(),
});
export type RunFingerprint = z.infer<typeof RunFingerprintSchema>;

/** Everything a fingerprint carries before the provider calls that produce `provider_params` have run. */
export type RunFingerprintContent = Omit<RunFingerprint, "provider_params">;

function hashBytes(contents: Uint8Array): string {
	return createHash("sha256").update(contents).digest("hex");
}

async function hashFileBytes(path: string): Promise<string> {
	return hashBytes(await readFile(path));
}

export async function hashSortedFileConcatenation(paths: readonly string[]): Promise<string> {
	const entries = await Promise.all(
		paths.map(async (path) => ({
			relativePath: relative(WORKSPACE_ROOT, path),
			digest: await hashFileBytes(path),
		})),
	);
	const sorted = [...entries].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
	const framed = sorted
		.map((entry) => `${entry.relativePath.length}:${entry.relativePath}\n${entry.digest}\n`)
		.join("");
	return createHash("sha256").update(framed).digest("hex");
}

export async function listDirectoryTypeScriptFiles(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true, recursive: true });
	return entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
		.map((entry) => join(entry.parentPath, entry.name));
}

export async function resolveCodeVersion(cwd: string): Promise<string | null> {
	// The only legitimate `null`: `cwd` is not inside any git repository. Anything
	// else that fails past this point is a real defect, not an absence, and must
	// propagate rather than be swallowed to the same `null`.
	let repoRoot: string;
	try {
		const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd });
		repoRoot = stdout.trim();
	} catch {
		return null;
	}

	const { stdout: headStdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd });
	const sha = headStdout.trim();

	// `:(top)` scopes the diff/status to the whole repository rather than to
	// `cwd`: `code_version`'s sha comes from repo-wide `git rev-parse HEAD`, so
	// the dirty suffix must see changes anywhere in the repo — not just inside
	// this package — or an edit to a dependency this package consumes (e.g. a
	// prompt builder in packages/generation-core) silently leaves the sha
	// looking pristine. Retained run files live under `apps/eval/results/` and
	// are themselves untracked output, not source: without the exclude, each
	// run this fingerprint helps produce would dirty the *next* run's
	// code_version, making the field flag "code changed" when only evidence
	// accumulated.
	const { stdout: diffStdout } = await execFileAsync(
		"git",
		["diff", "HEAD", "--", ":(top)", ":(exclude,top)apps/eval/results"],
		{ cwd },
	);
	const { stdout: statusStdout } = await execFileAsync(
		"git",
		["status", "--porcelain=v1", "-uall", "-z", "--", ":(top)", ":(exclude,top)apps/eval/results"],
		{ cwd },
	);
	const untrackedPaths = statusStdout
		.split("\0")
		.filter((entry) => entry.startsWith("?? "))
		.map((entry) => entry.slice(3));
	const untrackedContents = await Promise.all(
		untrackedPaths.map(
			async (path) => `${path}\n${(await readFile(join(repoRoot, path))).toString("utf8")}`,
		),
	);
	const workingTreeState = diffStdout + untrackedContents.join("");
	if (workingTreeState.length === 0) return sha;

	const dirtyHash = createHash("sha256").update(workingTreeState).digest("hex").slice(0, 12);
	return `${sha}-dirty-${dirtyHash}`;
}

/**
 * Collects everything that identifies a run except `provider_params`, which
 * is only known once the provider calls that produced the run have returned.
 * Takes the fixture's raw bytes rather than its path so a concurrent write
 * between reading the bytes and calling this cannot let the saved identity
 * name bytes the run never consumed. Call this immediately after the fixture
 * is read, before any provider call, per the fingerprint discipline.
 *
 * A judged run hashes the rubric, judge prompt, recorded judge provider, and
 * recorded judge response. A no-judge run excludes those inputs and carries
 * the stable empty rubrics hash, because none of them participated in that
 * run. The boolean is derived from effective config plus --no-judge before
 * this function is called.
 */
export async function collectRunFingerprint(
	fixtureBytes: Uint8Array,
	usesJudge: boolean,
): Promise<RunFingerprintContent> {
	const [checkFilePaths, contractsFilePaths, generationCoreFilePaths] = await Promise.all([
		listDirectoryTypeScriptFiles(CHECKS_DIRECTORY),
		listDirectoryTypeScriptFiles(CONTRACTS_SRC_DIRECTORY),
		listDirectoryTypeScriptFiles(GENERATION_CORE_SRC_DIRECTORY),
	]);
	const [checksSha256, providersSha256, rubricsSha256, schemasSha256, codeVersion] = await Promise.all([
		hashSortedFileConcatenation(checkFilePaths),
		hashSortedFileConcatenation([
			PROVIDERS_PATH,
			RECORDED_RESPONSE_PATH,
			RECORDED_MODEL_PROVIDER_PATH,
			RECORDED_MODEL_RESPONSE_PATH,
			...(usesJudge ? [RECORDED_JUDGE_MODEL_PROVIDER_PATH, RECORDED_JUDGE_RESPONSE_PATH] : []),
		]),
		hashSortedFileConcatenation(usesJudge ? [RUBRICS_PATH, JUDGE_PATH] : []),
		hashSortedFileConcatenation([...contractsFilePaths, ...generationCoreFilePaths]),
		resolveCodeVersion(PACKAGE_DIRECTORY),
	]);
	return {
		fixture_sha256: hashBytes(fixtureBytes),
		checks_sha256: checksSha256,
		providers_sha256: providersSha256,
		rubrics_sha256: rubricsSha256,
		schemas_sha256: schemasSha256,
		code_version: codeVersion,
	};
}
