import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { parseEvalCliCommand } from "../src/cli-options";
import { EvaluationReferenceManifestSchema, EvaluationReferenceManifestV3Schema } from "../src/evaluation-reference-corpus";
import { verifyEvaluationReferenceCorpus } from "../src/evaluation-reference-corpus-verifier";

const HASH = "1".repeat(64);

test("routes corpus browsing without extending existing namespaces", () => {
	expect(parseEvalCliCommand(["corpus", "show", "--corpus", "packages/fixtures/evaluation-corpus/manifest.json"])).toEqual({ command: "corpus-show", corpusPath: "packages/fixtures/evaluation-corpus/manifest.json" });
	expect(() => parseEvalCliCommand(["benchmark", "list", "--corpus", "manifest.json"])).toThrow("--corpus is not valid");
});

test("current corpus paths are semantic repository links without hashes", () => {
	const manifest = { version: 2, id: "corpus-one", fixtures: Array.from({ length: 12 }, (_, index) => ({ ordinal: index + 1, id: `fixture-${String(index + 1)}`, evidence_path: `packages/fixtures/evaluation-corpus/evidence/fixture-${String(index + 1)}.json`, reference_path: `packages/fixtures/evaluation-corpus/references/fixture-${String(index + 1)}.json`, variation_tags: [index === 0 ? "dense" : "names"], variation_witnesses: [{ tag: index === 0 ? "dense" : "names", reference_ids: [], message_ids: ["message-one"] }] })) };
	expect(EvaluationReferenceManifestSchema.safeParse(manifest).success).toBe(true);
	expect(JSON.stringify(EvaluationReferenceManifestSchema.parse(manifest))).not.toContain("sha256");
});

test("local corpus manifests retain exact local source references", () => {
	const manifest = {
		version: 3,
		id: "local-corpus-one",
		selection: { path: "corpora/local-one/selection.json", sha256: HASH },
		fixtures: [{
			ordinal: 1,
			id: "fixture-1",
			evidence: { path: "corpora/local-one/evidence/fixture-1.json", sha256: HASH },
			reference: { path: "corpora/local-one/references/fixture-1.json", sha256: HASH },
			variation_tags: ["names"],
			variation_witnesses: [{ tag: "names", reference_ids: ["entity:fixture-1"], message_ids: ["message-one"] }],
		}],
	};
	expect(EvaluationReferenceManifestV3Schema.safeParse(manifest).success).toBe(true);
	expect(EvaluationReferenceManifestV3Schema.parse(manifest).selection.path).toBe("corpora/local-one/selection.json");
	expect(EvaluationReferenceManifestV3Schema.parse(manifest).fixtures[0]?.evidence.sha256).toBe(HASH);
});

test("direct corpus proof resolves repository compatibility and local corpus closure", async () => {
	const root = await mkdtemp(join(tmpdir(), "bc-news-reference-corpus-test-"));
	try { await expect(verifyEvaluationReferenceCorpus(root)).resolves.toBe("EVALUATION REFERENCE CORPUS VERIFIED"); }
	finally { await rm(root, { recursive: true, force: true }); }
}, 90_000);
