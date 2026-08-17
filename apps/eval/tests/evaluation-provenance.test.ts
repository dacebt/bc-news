import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, test } from "vitest";
import { codeProvenance } from "../src/evaluation-provenance";

const execFileAsync = promisify(execFile);
const temporaryRepositories = new Set<string>();

afterEach(async () => {
	await Promise.all([...temporaryRepositories].map(async (root) => rm(root, { recursive: true, force: true })));
	temporaryRepositories.clear();
});

async function repository(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "bc-news-provenance-test-"));
	temporaryRepositories.add(root);
	await execFileAsync("git", ["init"], { cwd: root });
	await execFileAsync("git", ["config", "user.name", "Evaluation Test"], { cwd: root });
	await execFileAsync("git", ["config", "user.email", "evaluation@example.invalid"], { cwd: root });
	await writeFile(join(root, "source.txt"), "source\n", "utf8");
	await execFileAsync("git", ["add", "source.txt"], { cwd: root });
	await execFileAsync("git", ["commit", "-m", "fixture"], { cwd: root });
	return root;
}

test("keeps clean code provenance stable when an excluded result is generated", async () => {
	const root = await repository();
	const resultsDirectory = join(root, "custom-results");
	const first = await codeProvenance(root, resultsDirectory);
	await mkdir(resultsDirectory);
	await writeFile(join(resultsDirectory, "benchmark.json"), "{}\n", "utf8");
	const second = await codeProvenance(root, resultsDirectory);
	expect(first).toEqual(second);
	expect(first).toMatchObject({ repository: "bc-news", dirty: false });
	expect(first.commit_sha).toMatch(/^[0-9a-f]{40}$/u);
}, 30_000);

test("rejects dirty source instead of emitting reconstructible provenance", async () => {
	const root = await repository();
	await writeFile(join(root, "source.txt"), "changed\n", "utf8");
	await expect(codeProvenance(root, join(root, "results"))).rejects.toMatchObject({ code: "evaluation_code_provenance_unavailable" });
}, 30_000);

test("rejects a results exclusion that would hide tracked source", async () => {
	const root = await repository();
	const resultsDirectory = join(root, "tracked-results");
	await mkdir(resultsDirectory);
	await writeFile(join(resultsDirectory, "source.json"), "{}\n", "utf8");
	await execFileAsync("git", ["add", "tracked-results/source.json"], { cwd: root });
	await execFileAsync("git", ["commit", "-m", "tracked result"], { cwd: root });
	await expect(codeProvenance(root, resultsDirectory)).rejects.toThrow("would hide tracked source");
}, 30_000);
