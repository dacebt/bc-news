import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { expect, test } from "vitest";

const MUTABLE_BOUNDARIES = new Set([
	"config.ts",
	"model-adapters.ts",
	"product-checks.ts",
	"run-file.ts",
]);

async function topLevelValidatorGraph(): Promise<Map<string, string>> {
	const pending = ["evaluation-artifact-benchmark.ts"];
	const visited = new Map<string, string>();
	while (pending.length > 0) {
		const file = pending.pop()!;
		if (visited.has(file)) continue;
		const source = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
		visited.set(file, source);
		for (const match of source.matchAll(/(?:from\s+|import\s*)["'](\.\/[^"']+)["']/gu)) {
			const imported = `${match[1]!.slice(2)}.ts`;
			if (!visited.has(imported)) pending.push(imported);
		}
	}
	return visited;
}

test("artifact version 1 top-level validation has a closed frozen dependency graph", async () => {
	const graph = await topLevelValidatorGraph();
	for (const [file, source] of graph) {
		expect(MUTABLE_BOUNDARIES, file).not.toContain(basename(file));
		expect(source, file).not.toMatch(/@bc-news\/(?:generation-core|contracts|model-adapters)|packages\/(?:generation-core|contracts|model-adapters)/u);
		expect(source, file).not.toMatch(/build(?:MainStory|Announcements)WriterPrompt|(?<!V1_)WRITER_SYSTEM_CONSTRAINTS|fenceUntrustedTranscript/u);
	}
	expect([...graph.keys()]).toContain("evaluation-artifact-v1-contracts.ts");
});
