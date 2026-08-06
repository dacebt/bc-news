import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertCanonicalEvalDeterminism } from "./canonical-eval-determinism";
import { assertCanonicalEvalGrounding } from "./canonical-eval-grounding";
import { assertCanonicalEvalSemantics, assertRecordedConfig } from "./canonical-eval-semantics";
import { loadConfig } from "./config";
import { runCommand } from "./run-command";
import { RunFileSchema, type RunFile } from "./run-file";
import type { Edition } from "@bc-news/contracts";

const APP_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACE_ROOT = join(APP_DIRECTORY, "..", "..");
export const CANONICAL_CONFIG_PATH = join(APP_DIRECTORY, "eval.config.json");
export const CANONICAL_FIXTURE_PATH = join(
	WORKSPACE_ROOT,
	"packages",
	"fixtures",
	"evidence",
	"active-region-7_2026-01-24.json",
);

function parseStrictRun(bytes: Uint8Array, source: string): RunFile {
	let candidate: unknown;
	try {
		candidate = JSON.parse(Buffer.from(bytes).toString("utf8"));
	} catch (cause) {
		throw new Error(`${source} is not valid JSON`, { cause });
	}
	const parsed = RunFileSchema.safeParse(candidate);
	if (!parsed.success) {
		throw new Error(`${source} does not match the strict run contract: ${parsed.error.message}`);
	}
	return parsed.data;
}

async function executeCanonicalRun(resultsDirectory: string): Promise<{ path: string; run: RunFile }> {
	const saved = await runCommand({
		fixturePath: CANONICAL_FIXTURE_PATH,
		configPath: CANONICAL_CONFIG_PATH,
		resultsDirectory,
		environment: {},
	});
	return { path: saved.path, run: parseStrictRun(await readFile(saved.path), saved.path) };
}

/**
 * Executes the canonical generation run twice into walk-owned storage: the two
 * results must agree apart from run identity and timestamps, and the candidate
 * must satisfy the canonical semantics and recomputed grounding relations.
 * Recorded request stamps bind each response to the request current builders
 * produce; they are inspectable provenance, not a pin over fixture bytes.
 */
export async function verifyCanonicalEvalReplay(resultsDirectory: string): Promise<Edition> {
	const config = await loadConfig(CANONICAL_CONFIG_PATH);
	assertRecordedConfig(config);

	const candidate = await executeCanonicalRun(resultsDirectory);
	const repeat = await executeCanonicalRun(resultsDirectory);

	assertCanonicalEvalSemantics(candidate.run);
	await assertCanonicalEvalGrounding(candidate.run, CANONICAL_FIXTURE_PATH);
	assertCanonicalEvalDeterminism(candidate.run, repeat.run);

	console.log(`walk: four recorded production steps replayed, request-linked, and deterministic at ${candidate.path}`);
	return candidate.run.edition;
}
