import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Edition } from "@bc-news/contracts";
import type { EditorialDiagnostic } from "@bc-news/generation-core";
import { assertRecordedReplayAcceptanceDeterminism } from "./recorded-replay-acceptance-determinism";
import { assertRecordedReplayAcceptanceGrounding } from "./recorded-replay-acceptance-grounding";
import {
	assertRecordedReplayAcceptanceSemantics,
	assertRecordedReplayConfig,
} from "./recorded-replay-acceptance-semantics";
import { loadConfig } from "./config";
import { RECORDED_OUTPUT_FIXTURE_PATH } from "./representative-fixture";
import { runCommand } from "./run-command";
import { RunFileSchema, type RunFile } from "./run-file";

const APP_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), "..");
export const RECORDED_REPLAY_CONFIG_PATH = join(APP_DIRECTORY, "recorded-replay.config.json");

function parseStrictRun(bytes: Uint8Array, source: string): RunFile {
	let candidate: unknown;
	try {
		candidate = JSON.parse(Buffer.from(bytes).toString("utf8"));
	} catch (cause) {
		throw new Error(`${source} is not valid JSON`, { cause });
	}
	const parsed = RunFileSchema.safeParse(candidate);
	if (!parsed.success) {
		throw new Error(`${source} does not match the strict Run File contract: ${parsed.error.message}`);
	}
	return parsed.data;
}

async function executeRecordedReplayAcceptance(resultsDirectory: string): Promise<{ path: string; run: RunFile }> {
	const saved = await runCommand({
		fixturePath: RECORDED_OUTPUT_FIXTURE_PATH,
		configPath: RECORDED_REPLAY_CONFIG_PATH,
		resultsDirectory,
		environment: {},
	});
	return { path: saved.path, run: parseStrictRun(await readFile(saved.path), saved.path) };
}

export interface RecordedReplayAcceptanceResult {
	readonly edition: Edition;
	readonly diagnostics: readonly EditorialDiagnostic[];
}

export async function verifyRecordedReplayAcceptance(
	resultsDirectory?: string,
): Promise<RecordedReplayAcceptanceResult> {
	if (resultsDirectory !== undefined) return verifyRecordedReplayAcceptanceAt(resultsDirectory);
	const ownedRoot = await mkdtemp(join(tmpdir(), "bc-news-recorded-replay-acceptance-"));
	try {
		return await verifyRecordedReplayAcceptanceAt(join(ownedRoot, "results"));
	} finally {
		await rm(ownedRoot, { recursive: true, force: true });
	}
}

async function verifyRecordedReplayAcceptanceAt(
	resultsDirectory: string,
): Promise<RecordedReplayAcceptanceResult> {
	const config = await loadConfig(RECORDED_REPLAY_CONFIG_PATH);
	assertRecordedReplayConfig(config);
	const candidate = await executeRecordedReplayAcceptance(resultsDirectory);
	const repeat = await executeRecordedReplayAcceptance(resultsDirectory);
	assertRecordedReplayAcceptanceSemantics(candidate.run);
	await assertRecordedReplayAcceptanceGrounding(candidate.run, RECORDED_OUTPUT_FIXTURE_PATH);
	assertRecordedReplayAcceptanceDeterminism(candidate.run, repeat.run);
	return { edition: candidate.run.edition, diagnostics: candidate.run.diagnostics };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	verifyRecordedReplayAcceptance().then((result) => {
		console.log(`acceptance: two recorded writer steps replayed and deterministic; diagnostics retained: ${String(result.diagnostics.length)}`);
	}).catch((error: unknown) => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}
