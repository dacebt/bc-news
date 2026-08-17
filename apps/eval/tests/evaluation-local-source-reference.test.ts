import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
	EvaluationLocalSourceReferenceSchema,
	listEvaluationLocalSources,
	readEvaluationLocalSource,
	sourceReferenceForLocalFile,
} from "../src/evaluation-local-source-reference";

test("local source references hash exact bytes and list deterministic contained files", async () => {
	const root = await mkdtemp(join(tmpdir(), "bc-news-local-source-"));
	try {
		await mkdir(join(root, "corpus", "nested"), { recursive: true });
		await writeFile(join(root, "corpus", "alpha.txt"), "alpha\n", "utf8");
		await writeFile(join(root, "corpus", "nested", "bravo.txt"), "bravo\n", "utf8");
		const reference = await sourceReferenceForLocalFile(root, "corpus/nested/bravo.txt");
		expect(EvaluationLocalSourceReferenceSchema.parse(reference)).toEqual(reference);
		expect(Buffer.from(await readEvaluationLocalSource(root, reference)).toString("utf8")).toBe("bravo\n");
		await expect(readEvaluationLocalSource(root, { ...reference, sha256: "0".repeat(64) })).rejects.toBeInstanceOf(Error);
		expect(await listEvaluationLocalSources(root, "corpus")).toEqual(["corpus/alpha.txt", "corpus/nested/bravo.txt"]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("local source boundaries reject escaped and symlinked paths", async () => {
	const root = await mkdtemp(join(tmpdir(), "bc-news-local-source-"));
	try {
		await mkdir(join(root, "corpus"), { recursive: true });
		await writeFile(join(root, "corpus", "fixture.json"), "{\"ok\":true}\n", "utf8");
		for (const path of ["/absolute/fixture.json", "corpus\\fixture.json", "../corpus/fixture.json", "corpus/./fixture.json"]) {
			await expect(sourceReferenceForLocalFile(root, path)).rejects.toBeInstanceOf(Error);
		}
		await symlink(join(root, "corpus"), join(root, "corpus-link"));
		await expect(sourceReferenceForLocalFile(root, "corpus-link/fixture.json")).rejects.toBeInstanceOf(Error);
		await mkdir(join(root, "leaf-link"), { recursive: true });
		await symlink(join(root, "corpus", "fixture.json"), join(root, "leaf-link", "fixture.json"));
		await expect(sourceReferenceForLocalFile(root, "leaf-link/fixture.json")).rejects.toBeInstanceOf(Error);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
