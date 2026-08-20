import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { join, relative, sep } from "node:path";
import { promisify } from "node:util";
import { ACTIVE_REGION_IDS } from "@bc-news/contracts";

const execFileAsync = promisify(execFile);
const WORKSPACE_ROOT = new URL("../../../", import.meta.url).pathname;
const LEGACY_V2_SCORECARD_EVIDENCE_DIRECTORY = "apps/eval/scorecard-evidence/gemma-4-e4b-20260812";

export const LOCAL_SELECTION_REGION_IDS = ACTIVE_REGION_IDS.slice(0, 12);
export const CONTROLLED_REFERENCE_CORPUS_DIRECTORY = "packages/fixtures/evaluation-corpus";
export const LEGACY_V2_SCORECARD_EVIDENCE_ROOT = join(
	WORKSPACE_ROOT,
	LEGACY_V2_SCORECARD_EVIDENCE_DIRECTORY,
);

export function repositoryPath(root: string, path: string): string {
	return relative(root, path).split(sep).join("/");
}

export async function git(root: string, ...args: string[]): Promise<string> {
	const { stdout } = await execFileAsync("git", ["-C", root, ...args], { encoding: "utf8" });
	return stdout.trim();
}

export function hash(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

export function rebaseLegacyV2Path(path: string, targetDirectory: string): string {
	const legacyPrefix = `${LEGACY_V2_SCORECARD_EVIDENCE_DIRECTORY}/`;
	return `${targetDirectory}/${path.slice(legacyPrefix.length)}`;
}

export function controlledSourceProvenance(codeCommit: string) {
	return { repository: "bc-news", commit_sha: codeCommit, dirty: false } as const;
}
