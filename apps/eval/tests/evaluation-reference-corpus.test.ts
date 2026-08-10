import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { runEvalCliApplication } from "../src/cli";
import { parseEvalCliCommand } from "../src/cli-options";
import { EvaluationReferenceCorpusError, loadEvaluationReferenceCorpus } from "../src/evaluation-reference-corpus";
import { formatEvaluationReferenceCorpusReport } from "../src/evaluation-reference-corpus-report";
import { buildEphemeralEvaluationReferenceCorpus, verifyEvaluationReferenceCorpus } from "../src/evaluation-reference-corpus-verifier";

const roots: string[] = [];

async function corpus(): Promise<{ root: string; manifestPath: string }> {
	const root = await mkdtemp(join(tmpdir(), "bc-news-reference-corpus-test-"));
	roots.push(root);
	return { root, manifestPath: await buildEphemeralEvaluationReferenceCorpus(root) };
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("loads and reports an ordered source-grounded reference corpus", async () => {
	const { manifestPath } = await corpus();
	const loaded = await loadEvaluationReferenceCorpus(manifestPath);
	expect(loaded.entries).toHaveLength(12);
	expect(loaded.entries.map(({ manifestEntry }) => manifestEntry.ordinal)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
	expect(formatEvaluationReferenceCorpusReport(loaded)).toContain("Variation coverage: dense, overlapping_events");
	expect(formatEvaluationReferenceCorpusReport(loaded)).toContain("12. conversation-12");
});

test("routes corpus browsing without extending existing namespaces", async () => {
	const { root, manifestPath } = await corpus();
	expect(parseEvalCliCommand(["corpus", "show", "--corpus", manifestPath])).toEqual({ command: "corpus-show", corpusPath: manifestPath });
	expect(() => parseEvalCliCommand(["benchmark", "list", "--corpus", manifestPath])).toThrow("--corpus is not valid");
	let output = "";
	await runEvalCliApplication({
		argv: ["corpus", "show", "--corpus", manifestPath], currentDirectory: root, appDirectory: join(root, "app"), environment: {},
		writeOutput: (text) => { output += text; },
	});
	expect(output).toContain("Evaluation reference corpus v1: ephemeral-reference-corpus");
});

test("rejects positional reorder and exact-byte hash drift", async () => {
	const { manifestPath } = await corpus();
	const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { fixtures: Array<Record<string, unknown>> };
	[manifest.fixtures[0], manifest.fixtures[1]] = [manifest.fixtures[1]!, manifest.fixtures[0]!];
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
	await expect(loadEvaluationReferenceCorpus(manifestPath)).rejects.toMatchObject({ code: "invalid_order" });
	manifest.fixtures.sort((left, right) => Number(left.ordinal) - Number(right.ordinal));
	manifest.fixtures[0].evidence_sha256 = "0".repeat(64);
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
	await expect(loadEvaluationReferenceCorpus(manifestPath)).rejects.toMatchObject({ code: "hash_mismatch" });
});

test("direct proof rejects the frozen corruption matrix", async () => {
	const { manifestPath } = await corpus();
	await expect(verifyEvaluationReferenceCorpus(manifestPath)).resolves.toContain("Fixtures: 12");
}, 20_000);

test("returns structured application errors for strict-schema rejection", async () => {
	const { manifestPath } = await corpus();
	const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
	manifest.article = "forbidden target prose";
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
	try {
		await loadEvaluationReferenceCorpus(manifestPath);
		expect.unreachable("strict manifest should reject an extra field");
	} catch (error) {
		expect(error).toBeInstanceOf(EvaluationReferenceCorpusError);
		expect(error).toMatchObject({ code: "schema_rejected", path: manifestPath });
	}
});
