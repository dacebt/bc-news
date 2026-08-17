import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EvidenceFixtureSchema } from "@bc-news/contracts";
import { prepareEvidence } from "@bc-news/generation-core";
import { listEvaluationLocalSources } from "./evaluation-local-source-reference";
import {
	ProductionCorpusExtractionError,
	extractProductionCorpus,
	extractProductionCorpusWithHooks,
} from "./evaluation-corpus-extraction";
import { formatProductionCorpusExtractionReport } from "./evaluation-corpus-extraction-report";

const CANARY = "PRIVATE-CANARY-DO-NOT-LEAK";

interface SyntheticSnapshotRow {
	readonly entity_id: string;
	readonly region_id: number;
	readonly timestamp_ts: number | string | null;
	readonly username_raw: string | null;
	readonly username: string | null;
	readonly text: string | null;
}

function assertProof(condition: boolean, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function sha256(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function selectionPath(root: string, name: string): string {
	return join(root, `${name}.selection.json`);
}

function snapshotPath(root: string, name: string): string {
	return join(root, `${name}.sqlite`);
}

async function writeSelection(path: string, selection: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(selection, null, 2)}\n`, "utf8");
}

function createSnapshot(path: string, rows: readonly SyntheticSnapshotRow[]): void {
	mkdirSync(dirname(path), { recursive: true });
	const db = new DatabaseSync(path);
	try {
		db.exec(`
			CREATE TABLE chat_messages (
				entity_id TEXT NOT NULL,
				region_id INTEGER NOT NULL,
				timestamp_ts,
				username_raw,
				username,
				text
			)
		`);
		const statement = db.prepare(
			"INSERT INTO chat_messages (entity_id, region_id, timestamp_ts, username_raw, username, text) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
		);
		for (const row of rows) {
			statement.run(
				row.entity_id,
				row.region_id,
				typeof row.timestamp_ts === "number" && Number.isInteger(row.timestamp_ts)
					? BigInt(row.timestamp_ts)
					: row.timestamp_ts,
				row.username_raw,
				row.username,
				row.text,
			);
		}
	} finally {
		db.close();
	}
}

async function buildSuccessFixture(root: string): Promise<{ snapshot: string; selection: string; localDataRoot: string }> {
	const localDataRoot = join(root, "local-data");
	const snapshot = snapshotPath(root, "success");
	createSnapshot(snapshot, [
		{ entity_id: "dense-a", region_id: 9, timestamp_ts: Date.parse("2026-08-16T10:00:00.000Z"), username_raw: "r9/alpha", username: "Alpha", text: " First retained line " },
		{ entity_id: "dense-b", region_id: 9, timestamp_ts: Date.parse("2026-08-16T10:00:10.000Z"), username_raw: "r9/alpha", username: "Alpha", text: "Second retained line" },
		{ entity_id: "dense-c", region_id: 9, timestamp_ts: Date.parse("2026-08-16T10:01:00.000Z"), username_raw: "r9/bravo", username: "Bravo", text: " " },
		{ entity_id: "dense-gap", region_id: 9, timestamp_ts: Date.parse("2026-08-16T10:03:00.000Z"), username_raw: "r9/gap", username: "Gap", text: CANARY },
		{ entity_id: "dense-end", region_id: 9, timestamp_ts: Date.parse("2026-08-16T10:02:00.000Z"), username_raw: "r9/end", username: "End", text: CANARY },
		{ entity_id: "dense-j", region_id: 9, timestamp_ts: Date.parse("2026-08-16T10:05:00.000Z"), username_raw: "r9/juliet", username: "Juliet", text: "Third retained line" },
		{ entity_id: "dense-k", region_id: 9, timestamp_ts: Date.parse("2026-08-16T10:05:00.000Z"), username_raw: "r9/kilo", username: "Kilo", text: "Fourth retained line" },
		{ entity_id: "wrong-region", region_id: 14, timestamp_ts: Date.parse("2026-08-16T10:00:30.000Z"), username_raw: "r14/canary", username: "Canary", text: CANARY },
		{ entity_id: "sparse-a", region_id: 15, timestamp_ts: Date.parse("2026-08-16T11:00:00.000Z"), username_raw: "r15/helper", username: "Helper", text: "Need one more rope bundle" },
	]);
	const snapshotBytes = await readFile(snapshot);
	const selection = selectionPath(root, "success");
	await writeSelection(selection, {
		version: 1,
		id: "synthetic-production-corpus",
		snapshot_sha256: sha256(snapshotBytes),
		evidence_date: "2026-08-16",
		cases: [
			{
				ordinal: 1,
				id: "windowed-dense-case",
				active_region_id: "9",
				windows: [
					{ start_utc: "2026-08-16T10:00:00.000Z", end_utc: "2026-08-16T10:02:00.000Z" },
					{ start_utc: "2026-08-16T10:05:00.000Z", end_utc: "2026-08-16T10:06:00.000Z" },
				],
				expected_raw_count: 5,
				expected_prepared_count: 3,
			},
			{
				ordinal: 2,
				id: "single-sparse-case",
				active_region_id: "15",
				windows: [{ start_utc: "2026-08-16T11:00:00.000Z", end_utc: "2026-08-16T11:01:00.000Z" }],
				expected_raw_count: 1,
				expected_prepared_count: 1,
			},
		],
	});
	return { snapshot, selection, localDataRoot };
}

async function expectExtractionError(
	input: { snapshotPath: string; selectionPath: string; localDataRoot: string },
	expectedCode: ProductionCorpusExtractionError["code"],
): Promise<ProductionCorpusExtractionError> {
	try {
		await extractProductionCorpus(input);
	} catch (error) {
		assertProof(error instanceof ProductionCorpusExtractionError, "Extraction failed with an untyped error");
		assertProof(error.code === expectedCode, `Expected ${expectedCode}, received ${error.code}`);
		assertProof(!error.message.includes(CANARY), "Private canary leaked through a public extraction error");
		return error;
	}
	throw new Error(`Expected extraction to reject with ${expectedCode}`);
}

async function listStagingDirectories(localDataRoot: string, selectionId: string): Promise<string[]> {
	return (await readdir(resolve(localDataRoot, "corpus-workspaces"))).filter((name) =>
		name.startsWith(`.${selectionId}-staging-`),
	);
}

async function verifySuccess(root: string): Promise<void> {
	const fixture = await buildSuccessFixture(root);
	const result = await extractProductionCorpus({
		snapshotPath: fixture.snapshot,
		selectionPath: fixture.selection,
		localDataRoot: fixture.localDataRoot,
	});
	assertProof(result.workspacePath === "corpus-workspaces/synthetic-production-corpus", "Relative workspace path drifted");
	assertProof(result.totalRawCount === 6 && result.totalPreparedCount === 4, "Count totals drifted");
	assertProof(result.snapshotSha256 === result.copiedSnapshotSha256, "Snapshot copy hash drifted");
	assertProof(result.cases.map(({ id }) => id).join("|") === "windowed-dense-case|single-sparse-case", "Case roster drifted");

	const report = formatProductionCorpusExtractionReport(result);
	assertProof(report.includes("Workspace: corpus-workspaces/synthetic-production-corpus"), "Report omitted the relative workspace");
	assertProof(report.includes("Messages: raw=6 prepared=4"), "Report omitted the frozen totals");
	assertProof(!report.includes(CANARY), "Private canary leaked through the count-only report");

	const stagedSnapshot = await readFile(resolve(fixture.localDataRoot, result.snapshotPath));
	const sourceSnapshot = await readFile(fixture.snapshot);
	assertProof(Buffer.compare(stagedSnapshot, sourceSnapshot) === 0, "Snapshot copy bytes changed");
	const stagedSelection = await readFile(resolve(fixture.localDataRoot, result.selectionPath));
	const sourceSelection = await readFile(fixture.selection);
	assertProof(Buffer.compare(stagedSelection, sourceSelection) === 0, "Selection copy bytes changed");

	const listed = await listEvaluationLocalSources(fixture.localDataRoot, result.workspacePath);
	assertProof(listed.join("|") === [
		"corpus-workspaces/synthetic-production-corpus/reference-corpus/evidence/single-sparse-case.json",
		"corpus-workspaces/synthetic-production-corpus/reference-corpus/evidence/windowed-dense-case.json",
		"corpus-workspaces/synthetic-production-corpus/reference-corpus/selection.json",
		"corpus-workspaces/synthetic-production-corpus/snapshot.sqlite",
	].join("|"), "Extraction workspace file roster drifted");

		const denseFixture: unknown = JSON.parse(
			Buffer.from(await readFile(resolve(fixture.localDataRoot, result.cases[0]!.evidencePath))).toString("utf8"),
		);
		const parsedDenseFixture = EvidenceFixtureSchema.parse(denseFixture);
		assertProof(parsedDenseFixture.messages.map(({ id }) => id).join("|") === "dense-a|dense-b|dense-c|dense-j|dense-k", "Raw fixture order drifted");
		const prepared = prepareEvidence({
			activeRegionId: "9",
			publicationDate: "2026-08-17",
			messages: parsedDenseFixture.messages,
		});
		assertProof(prepared.final_count === 3, "Canonical preparation count drifted");
		assertProof(prepared.messages[0]?.text === "First retained line\nSecond retained line", "Burst merge drifted");
		assertProof(!JSON.stringify(parsedDenseFixture).includes(CANARY), "Private canary leaked into retained fixture bytes");
	assertProof((await readdir(resolve(fixture.localDataRoot, "corpus-workspaces"))).every((name) => !name.startsWith(".synthetic-production-corpus-staging-")), "Staging directory was left behind");
}

async function verifyStageCleanupOnHookFailure(root: string): Promise<void> {
	const fixture = await buildSuccessFixture(root);
	await writeSelection(fixture.selection, {
		version: 1,
		id: "hook-stage-cleanup",
		snapshot_sha256: sha256(await readFile(fixture.snapshot)),
		evidence_date: "2026-08-16",
		cases: [
			{
				ordinal: 1,
				id: "windowed-dense-case",
				active_region_id: "9",
				windows: [
					{ start_utc: "2026-08-16T10:00:00.000Z", end_utc: "2026-08-16T10:02:00.000Z" },
					{ start_utc: "2026-08-16T10:05:00.000Z", end_utc: "2026-08-16T10:06:00.000Z" },
				],
				expected_raw_count: 5,
				expected_prepared_count: 3,
			},
			{
				ordinal: 2,
				id: "single-sparse-case",
				active_region_id: "15",
				windows: [{ start_utc: "2026-08-16T11:00:00.000Z", end_utc: "2026-08-16T11:01:00.000Z" }],
				expected_raw_count: 1,
				expected_prepared_count: 1,
			},
		],
	});
	try {
		await extractProductionCorpusWithHooks(
			{
				snapshotPath: fixture.snapshot,
				selectionPath: fixture.selection,
				localDataRoot: fixture.localDataRoot,
			},
			{
				afterSnapshotStaged: () => {
					throw new Error("Synthetic afterSnapshotStaged failure");
				},
			},
		);
		throw new Error("Expected afterSnapshotStaged failure");
	} catch (error) {
		assertProof(error instanceof Error, "Hook failure rejected with a non-error value");
		assertProof(error.message === "Synthetic afterSnapshotStaged failure", "Hook failure message drifted");
	}
	assertProof((await listStagingDirectories(fixture.localDataRoot, "hook-stage-cleanup")).length === 0, "Hook-stage cleanup left a staging directory behind");
	assertProof((await readdir(resolve(fixture.localDataRoot, "corpus-workspaces"))).length === 0, "Hook-stage cleanup changed the workspace root shape");
}

async function verifyOutOfWindowTimestampFiltering(root: string): Promise<void> {
	const snapshot = snapshotPath(root, "window-filter");
	const selection = selectionPath(root, "window-filter");
	const localDataRoot = join(root, "local-data");
	createSnapshot(snapshot, [
		{ entity_id: "selected-row", region_id: 9, timestamp_ts: Date.parse("2026-08-16T10:00:00.000Z"), username_raw: "r9/alpha", username: "Alpha", text: "Selected line" },
		{ entity_id: "bad-out-of-window", region_id: 9, timestamp_ts: CANARY, username_raw: "r9/bad", username: "Bad", text: "Ignored line" },
	]);
	await writeSelection(selection, {
		version: 1,
		id: "window-filter",
		snapshot_sha256: sha256(await readFile(snapshot)),
		evidence_date: "2026-08-16",
		cases: [{
			ordinal: 1,
			id: "window-filter-case",
			active_region_id: "9",
			windows: [{ start_utc: "2026-08-16T10:00:00.000Z", end_utc: "2026-08-16T10:01:00.000Z" }],
			expected_raw_count: 1,
			expected_prepared_count: 1,
		}],
	});
	const result = await extractProductionCorpus({ snapshotPath: snapshot, selectionPath: selection, localDataRoot });
	const fixture = EvidenceFixtureSchema.parse(JSON.parse(await readFile(resolve(localDataRoot, result.cases[0]!.evidencePath), "utf8")) as unknown);
	assertProof(fixture.messages.map(({ id }) => id).join("|") === "selected-row", "Out-of-window malformed timestamps polluted the selected roster");
	assertProof(!JSON.stringify(fixture).includes(CANARY), "Out-of-window malformed timestamps leaked into retained fixture bytes");
}

async function verifyStagedSnapshotQuery(root: string): Promise<void> {
	const snapshot = snapshotPath(root, "staged-query");
	const selection = selectionPath(root, "staged-query");
	const localDataRoot = join(root, "local-data");
	createSnapshot(snapshot, [
		{ entity_id: "original-row", region_id: 9, timestamp_ts: Date.parse("2026-08-16T10:00:00.000Z"), username_raw: "r9/original", username: "Original", text: "Original staged line" },
	]);
	await writeSelection(selection, {
		version: 1,
		id: "staged-query-proof",
		snapshot_sha256: sha256(await readFile(snapshot)),
		evidence_date: "2026-08-16",
		cases: [{
			ordinal: 1,
			id: "staged-query-case",
			active_region_id: "9",
			windows: [{ start_utc: "2026-08-16T10:00:00.000Z", end_utc: "2026-08-16T10:01:00.000Z" }],
			expected_raw_count: 1,
			expected_prepared_count: 1,
		}],
	});
	const result = await extractProductionCorpusWithHooks(
		{ snapshotPath: snapshot, selectionPath: selection, localDataRoot },
		{
			afterSnapshotStaged: ({ sourceSnapshotPath }) => {
				const db = new DatabaseSync(sourceSnapshotPath);
				try {
					db.exec("DELETE FROM chat_messages");
					db.prepare(
						"INSERT INTO chat_messages (entity_id, region_id, timestamp_ts, username_raw, username, text) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
					).run(
						"mutated-row",
						9,
						BigInt(Date.parse("2026-08-16T10:00:00.000Z")),
						"r9/mutated",
						"Mutated",
						CANARY,
					);
				} finally {
					db.close();
				}
			},
		},
	);
	const fixture = EvidenceFixtureSchema.parse(JSON.parse(await readFile(resolve(localDataRoot, result.cases[0]!.evidencePath), "utf8")) as unknown);
	assertProof(
		fixture.messages.map(({ id, text }) => `${id}:${text}`).join("|") === "original-row:Original staged line",
		"Extraction queried the later-mutated source snapshot instead of the staged verified copy",
	);
	assertProof(!JSON.stringify(fixture).includes(CANARY), "Mutated source bytes leaked into retained fixture bytes");
}

async function verifyFailures(root: string): Promise<void> {
	const localDataRoot = join(root, "local-data");
	await mkdir(localDataRoot, { recursive: true });

	const digestSnapshot = snapshotPath(root, "digest-mismatch");
	createSnapshot(digestSnapshot, []);
	const digestSelection = selectionPath(root, "digest-mismatch");
	await writeSelection(digestSelection, {
		version: 1,
		id: "digest-mismatch",
		snapshot_sha256: "0".repeat(64),
		evidence_date: "2026-08-16",
		cases: [{
			ordinal: 1,
			id: "missing-case",
			active_region_id: "9",
			windows: [{ start_utc: "2026-08-16T10:00:00.000Z", end_utc: "2026-08-16T10:01:00.000Z" }],
			expected_raw_count: 1,
			expected_prepared_count: 1,
		}],
	});
	await expectExtractionError({ snapshotPath: digestSnapshot, selectionPath: digestSelection, localDataRoot }, "snapshot_digest_mismatch");

	const sidecarSnapshot = snapshotPath(root, "sidecar");
	createSnapshot(sidecarSnapshot, []);
	await writeFile(`${sidecarSnapshot}-wal`, "sidecar\n", "utf8");
	const sidecarSelection = selectionPath(root, "sidecar");
	await writeSelection(sidecarSelection, {
		version: 1,
		id: "sidecar-case",
		snapshot_sha256: sha256(await readFile(sidecarSnapshot)),
		evidence_date: "2026-08-16",
		cases: [{
			ordinal: 1,
			id: "sidecar-case",
			active_region_id: "9",
			windows: [{ start_utc: "2026-08-16T10:00:00.000Z", end_utc: "2026-08-16T10:01:00.000Z" }],
			expected_raw_count: 1,
			expected_prepared_count: 1,
		}],
	});
	await expectExtractionError({ snapshotPath: sidecarSnapshot, selectionPath: sidecarSelection, localDataRoot }, "snapshot_sidecar_present");

	const malformedSnapshot = snapshotPath(root, "malformed");
	createSnapshot(malformedSnapshot, [
		{ entity_id: "bad-out-of-window", region_id: 9, timestamp_ts: CANARY, username_raw: "r9/bad", username: "Bad", text: "ignored text" },
		{ entity_id: "selected-bad-row", region_id: 9, timestamp_ts: Date.parse("2026-08-16T10:00:00.000Z"), username_raw: null, username: "Bad", text: "safe text" },
	]);
	const malformedSelection = selectionPath(root, "malformed");
	await writeSelection(malformedSelection, {
		version: 1,
		id: "malformed-case",
		snapshot_sha256: sha256(await readFile(malformedSnapshot)),
		evidence_date: "2026-08-16",
		cases: [{
			ordinal: 1,
			id: "malformed-case",
			active_region_id: "9",
			windows: [{ start_utc: "2026-08-16T10:00:00.000Z", end_utc: "2026-08-16T10:01:00.000Z" }],
			expected_raw_count: 1,
			expected_prepared_count: 1,
		}],
	});
	await expectExtractionError({ snapshotPath: malformedSnapshot, selectionPath: malformedSelection, localDataRoot }, "snapshot_row_rejected");

	const zeroSnapshot = snapshotPath(root, "zero");
	createSnapshot(zeroSnapshot, [
		{ entity_id: "wrong-region", region_id: 14, timestamp_ts: Date.parse("2026-08-16T10:00:00.000Z"), username_raw: "r14/wrong", username: "Wrong", text: CANARY },
	]);
	const zeroSelection = selectionPath(root, "zero");
	await writeSelection(zeroSelection, {
		version: 1,
		id: "zero-case",
		snapshot_sha256: sha256(await readFile(zeroSnapshot)),
		evidence_date: "2026-08-16",
		cases: [{
			ordinal: 1,
			id: "zero-case",
			active_region_id: "9",
			windows: [{ start_utc: "2026-08-16T10:00:00.000Z", end_utc: "2026-08-16T10:01:00.000Z" }],
			expected_raw_count: 1,
			expected_prepared_count: 1,
		}],
	});
	await expectExtractionError({ snapshotPath: zeroSnapshot, selectionPath: zeroSelection, localDataRoot }, "extraction_count_mismatch");
	assertProof((await readdir(localDataRoot)).join("|") === "corpus-workspaces", "A failed extraction changed the local-data root shape");
	assertProof((await readdir(resolve(localDataRoot, "corpus-workspaces"))).length === 0, "A failed extraction left a final workspace behind");

	const existing = await buildSuccessFixture(join(root, "existing"));
	await mkdir(resolve(existing.localDataRoot, "corpus-workspaces", "synthetic-production-corpus"), { recursive: true });
	await expectExtractionError(
		{ snapshotPath: existing.snapshot, selectionPath: existing.selection, localDataRoot: existing.localDataRoot },
		"workspace_exists",
	);
}

export async function verifyEvaluationCorpusExtraction(temporaryRoot?: string): Promise<string> {
	const root = temporaryRoot ?? await mkdtemp(join(tmpdir(), "bc-news-corpus-extraction-"));
	const cleanup = temporaryRoot === undefined;
	try {
		await verifySuccess(join(root, "success"));
		await verifyStageCleanupOnHookFailure(join(root, "stage-cleanup"));
		await verifyOutOfWindowTimestampFiltering(join(root, "window-filter"));
		await verifyStagedSnapshotQuery(join(root, "staged-query"));
		await verifyFailures(join(root, "failures"));
		return "EVALUATION CORPUS EXTRACTION VERIFIED";
	} finally {
		if (cleanup) await rm(root, { recursive: true, force: true });
	}
}

async function main(): Promise<void> {
	process.stdout.write(`${await verifyEvaluationCorpusExtraction()}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
