import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { expect, test } from "vitest";
import { EvidenceFixtureSchema } from "@bc-news/contracts";
import { prepareEvidence } from "@bc-news/generation-core";
import { listEvaluationLocalSources } from "../src/evaluation-local-source-reference";
import {
	ProductionCorpusExtractionError,
	extractProductionCorpus,
	extractProductionCorpusWithHooks,
} from "../src/evaluation-corpus-extraction";
import { formatProductionCorpusExtractionReport } from "../src/evaluation-corpus-extraction-report";
import { verifyEvaluationCorpusExtraction } from "../src/evaluation-corpus-extraction-verifier";

const CANARY = "PRIVATE-CANARY-DO-NOT-LEAK";

interface SyntheticSnapshotRow {
	readonly entity_id: string;
	readonly region_id: number;
	readonly timestamp_ts: number | string | null;
	readonly username_raw: string | null;
	readonly username: string | null;
	readonly text: string | null;
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

async function writeSelection(path: string, selection: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(selection, null, 2)}\n`, "utf8");
}

async function sha256(bytes: Uint8Array): Promise<string> {
	const input = new Uint8Array(bytes.byteLength);
	input.set(bytes);
	return Buffer.from(await crypto.subtle.digest("SHA-256", input)).toString("hex");
}

async function expectTypedFailure(
	input: { snapshotPath: string; selectionPath: string; localDataRoot: string },
	code: ProductionCorpusExtractionError["code"],
): Promise<ProductionCorpusExtractionError> {
	try {
		await extractProductionCorpus(input);
	} catch (error) {
		expect(error).toBeInstanceOf(ProductionCorpusExtractionError);
		const typed = error as ProductionCorpusExtractionError;
		expect(typed.code).toBe(code);
		expect(typed.message).not.toContain(CANARY);
		return typed;
	}
	throw new Error(`Expected ${code}`);
}

async function listStagingDirectories(localDataRoot: string, selectionId: string): Promise<string[]> {
	return (await readdir(resolve(localDataRoot, "corpus-workspaces"))).filter((name) =>
		name.startsWith(`.${selectionId}-staging-`),
	);
}

test("extracts the selected raw corpus through the canonical preparation path and publishes one atomic workspace", async () => {
	const root = await mkdtemp(join(tmpdir(), "bc-news-corpus-extraction-"));
	try {
		const snapshotPath = join(root, "snapshot.sqlite");
		const selectionPath = join(root, "selection.json");
		const localDataRoot = join(root, "local-data");
		createSnapshot(snapshotPath, [
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
		const snapshotBytes = await readFile(snapshotPath);
		await writeSelection(selectionPath, {
			version: 1,
			id: "synthetic-production-corpus",
			snapshot_sha256: await sha256(snapshotBytes),
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

		const result = await extractProductionCorpus({ snapshotPath, selectionPath, localDataRoot });
		expect(result.workspacePath).toBe("corpus-workspaces/synthetic-production-corpus");
		expect(result.totalRawCount).toBe(6);
		expect(result.totalPreparedCount).toBe(4);
		expect(result.snapshotSha256).toBe(result.copiedSnapshotSha256);
		expect(result.cases.map(({ id }) => id)).toEqual(["windowed-dense-case", "single-sparse-case"]);

		const report = formatProductionCorpusExtractionReport(result);
		expect(report).toContain("Workspace: corpus-workspaces/synthetic-production-corpus");
		expect(report).toContain("Messages: raw=6 prepared=4");
		expect(report).not.toContain(CANARY);

		expect(Buffer.from(await readFile(resolve(localDataRoot, result.snapshotPath)))).toEqual(snapshotBytes);
		expect(Buffer.from(await readFile(resolve(localDataRoot, result.selectionPath)))).toEqual(await readFile(selectionPath));
		expect(await listEvaluationLocalSources(localDataRoot, result.workspacePath)).toEqual([
			"corpus-workspaces/synthetic-production-corpus/reference-corpus/evidence/single-sparse-case.json",
			"corpus-workspaces/synthetic-production-corpus/reference-corpus/evidence/windowed-dense-case.json",
			"corpus-workspaces/synthetic-production-corpus/reference-corpus/selection.json",
			"corpus-workspaces/synthetic-production-corpus/snapshot.sqlite",
		]);
		expect((await readdir(resolve(localDataRoot, "corpus-workspaces"))).every((name) => !name.startsWith(".synthetic-production-corpus-staging-"))).toBe(true);

		const denseFixture: unknown = JSON.parse(
			Buffer.from(await readFile(resolve(localDataRoot, result.cases[0]!.evidencePath))).toString("utf8"),
		);
		const parsedDenseFixture = EvidenceFixtureSchema.parse(denseFixture);
		expect(parsedDenseFixture.messages.map(({ id }) => id)).toEqual(["dense-a", "dense-b", "dense-c", "dense-j", "dense-k"]);
		expect(JSON.stringify(parsedDenseFixture)).not.toContain(CANARY);
		const prepared = prepareEvidence({
			activeRegionId: "9",
			publicationDate: "2026-08-17",
			messages: parsedDenseFixture.messages,
		});
		expect(prepared.final_count).toBe(3);
		expect(prepared.messages[0]?.text).toBe("First retained line\nSecond retained line");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("cleans the staging workspace when afterSnapshotStaged throws before the stage handle is returned", async () => {
	const root = await mkdtemp(join(tmpdir(), "bc-news-corpus-extraction-stage-cleanup-"));
	try {
		const snapshotPath = join(root, "snapshot.sqlite");
		const selectionPath = join(root, "selection.json");
		const localDataRoot = join(root, "local-data");
		createSnapshot(snapshotPath, [
			{ entity_id: "dense-a", region_id: 9, timestamp_ts: Date.parse("2026-08-16T10:00:00.000Z"), username_raw: "r9/alpha", username: "Alpha", text: "First retained line" },
		]);
		await writeSelection(selectionPath, {
			version: 1,
			id: "hook-stage-cleanup",
			snapshot_sha256: await sha256(await readFile(snapshotPath)),
			evidence_date: "2026-08-16",
			cases: [{ ordinal: 1, id: "single-case", active_region_id: "9", windows: [{ start_utc: "2026-08-16T10:00:00.000Z", end_utc: "2026-08-16T10:01:00.000Z" }], expected_raw_count: 1, expected_prepared_count: 1 }],
		});

		await expect(
			extractProductionCorpusWithHooks(
				{ snapshotPath, selectionPath, localDataRoot },
				{
					afterSnapshotStaged: () => {
						throw new Error("Synthetic afterSnapshotStaged failure");
					},
				},
			),
		).rejects.toThrow("Synthetic afterSnapshotStaged failure");
		expect(await listStagingDirectories(localDataRoot, "hook-stage-cleanup")).toEqual([]);
		expect(await readdir(resolve(localDataRoot, "corpus-workspaces"))).toEqual([]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("ignores malformed timestamps outside every declared window for the same region", async () => {
	const root = await mkdtemp(join(tmpdir(), "bc-news-corpus-extraction-window-filter-"));
	try {
		const snapshotPath = join(root, "snapshot.sqlite");
		const selectionPath = join(root, "selection.json");
		const localDataRoot = join(root, "local-data");
		createSnapshot(snapshotPath, [
			{ entity_id: "selected-row", region_id: 9, timestamp_ts: Date.parse("2026-08-16T10:00:00.000Z"), username_raw: "r9/alpha", username: "Alpha", text: "Selected line" },
			{ entity_id: "bad-out-of-window", region_id: 9, timestamp_ts: CANARY, username_raw: "r9/bad", username: "Bad", text: "Ignored line" },
		]);
		await writeSelection(selectionPath, {
			version: 1,
			id: "window-filter",
			snapshot_sha256: await sha256(await readFile(snapshotPath)),
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

		const result = await extractProductionCorpus({ snapshotPath, selectionPath, localDataRoot });
		const fixture: unknown = JSON.parse(
			Buffer.from(await readFile(resolve(localDataRoot, result.cases[0]!.evidencePath))).toString("utf8"),
		);
		const parsedFixture = EvidenceFixtureSchema.parse(fixture);
		expect(parsedFixture.messages.map(({ id }) => id)).toEqual(["selected-row"]);
		expect(JSON.stringify(parsedFixture)).not.toContain(CANARY);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("queries the staged verified snapshot instead of a later-mutated source snapshot", async () => {
	const root = await mkdtemp(join(tmpdir(), "bc-news-corpus-extraction-staged-query-"));
	try {
		const snapshotPath = join(root, "snapshot.sqlite");
		const selectionPath = join(root, "selection.json");
		const localDataRoot = join(root, "local-data");
		createSnapshot(snapshotPath, [
			{ entity_id: "original-row", region_id: 9, timestamp_ts: Date.parse("2026-08-16T10:00:00.000Z"), username_raw: "r9/original", username: "Original", text: "Original staged line" },
		]);
		await writeSelection(selectionPath, {
			version: 1,
			id: "staged-query-proof",
			snapshot_sha256: await sha256(await readFile(snapshotPath)),
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
			{ snapshotPath, selectionPath, localDataRoot },
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
		const fixture: unknown = JSON.parse(
			Buffer.from(await readFile(resolve(localDataRoot, result.cases[0]!.evidencePath))).toString("utf8"),
		);
		const parsedFixture = EvidenceFixtureSchema.parse(fixture);
		expect(parsedFixture.messages.map(({ id, text }) => ({ id, text }))).toEqual([
			{ id: "original-row", text: "Original staged line" },
		]);
		expect(JSON.stringify(parsedFixture)).not.toContain(CANARY);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("rejects digest mismatch, sidecars, malformed rows, zero fetch mismatch, and existing targets without leaking private content", async () => {
	const root = await mkdtemp(join(tmpdir(), "bc-news-corpus-extraction-failure-"));
	try {
		const localDataRoot = join(root, "local-data");
		await mkdir(localDataRoot, { recursive: true });

		const digestSnapshot = join(root, "digest.sqlite");
		createSnapshot(digestSnapshot, []);
		const digestSelection = join(root, "digest.selection.json");
		await writeSelection(digestSelection, {
			version: 1,
			id: "digest-mismatch",
			snapshot_sha256: "0".repeat(64),
			evidence_date: "2026-08-16",
			cases: [{ ordinal: 1, id: "missing-case", active_region_id: "9", windows: [{ start_utc: "2026-08-16T10:00:00.000Z", end_utc: "2026-08-16T10:01:00.000Z" }], expected_raw_count: 1, expected_prepared_count: 1 }],
		});
		await expectTypedFailure({ snapshotPath: digestSnapshot, selectionPath: digestSelection, localDataRoot }, "snapshot_digest_mismatch");

		const sidecarSnapshot = join(root, "sidecar.sqlite");
		createSnapshot(sidecarSnapshot, []);
		await writeFile(`${sidecarSnapshot}-wal`, "sidecar\n", "utf8");
		const sidecarSelection = join(root, "sidecar.selection.json");
		await writeSelection(sidecarSelection, {
			version: 1,
			id: "sidecar-case",
			snapshot_sha256: await sha256(await readFile(sidecarSnapshot)),
			evidence_date: "2026-08-16",
			cases: [{ ordinal: 1, id: "sidecar-case", active_region_id: "9", windows: [{ start_utc: "2026-08-16T10:00:00.000Z", end_utc: "2026-08-16T10:01:00.000Z" }], expected_raw_count: 1, expected_prepared_count: 1 }],
		});
		await expectTypedFailure({ snapshotPath: sidecarSnapshot, selectionPath: sidecarSelection, localDataRoot }, "snapshot_sidecar_present");

		const malformedSnapshot = join(root, "malformed.sqlite");
		createSnapshot(malformedSnapshot, [
			{ entity_id: "bad-out-of-window", region_id: 9, timestamp_ts: CANARY, username_raw: "r9/bad", username: "Bad", text: "ignored text" },
			{ entity_id: "selected-bad-row", region_id: 9, timestamp_ts: Date.parse("2026-08-16T10:00:00.000Z"), username_raw: null, username: "Bad", text: "safe text" },
		]);
		const malformedSelection = join(root, "malformed.selection.json");
		await writeSelection(malformedSelection, {
			version: 1,
			id: "malformed-case",
			snapshot_sha256: await sha256(await readFile(malformedSnapshot)),
			evidence_date: "2026-08-16",
			cases: [{ ordinal: 1, id: "malformed-case", active_region_id: "9", windows: [{ start_utc: "2026-08-16T10:00:00.000Z", end_utc: "2026-08-16T10:01:00.000Z" }], expected_raw_count: 1, expected_prepared_count: 1 }],
		});
		await expectTypedFailure({ snapshotPath: malformedSnapshot, selectionPath: malformedSelection, localDataRoot }, "snapshot_row_rejected");

		const zeroSnapshot = join(root, "zero.sqlite");
		createSnapshot(zeroSnapshot, [
			{ entity_id: "wrong-region", region_id: 14, timestamp_ts: Date.parse("2026-08-16T10:00:00.000Z"), username_raw: "r14/wrong", username: "Wrong", text: CANARY },
		]);
		const zeroSelection = join(root, "zero.selection.json");
		await writeSelection(zeroSelection, {
			version: 1,
			id: "zero-case",
			snapshot_sha256: await sha256(await readFile(zeroSnapshot)),
			evidence_date: "2026-08-16",
			cases: [{ ordinal: 1, id: "zero-case", active_region_id: "9", windows: [{ start_utc: "2026-08-16T10:00:00.000Z", end_utc: "2026-08-16T10:01:00.000Z" }], expected_raw_count: 1, expected_prepared_count: 1 }],
		});
		await expectTypedFailure({ snapshotPath: zeroSnapshot, selectionPath: zeroSelection, localDataRoot }, "extraction_count_mismatch");
		expect(await readdir(localDataRoot)).toEqual(["corpus-workspaces"]);
		expect(await readdir(resolve(localDataRoot, "corpus-workspaces"))).toEqual([]);

		const existingRoot = join(root, "existing");
		const existingLocalDataRoot = join(existingRoot, "local-data");
		const existingSnapshot = join(existingRoot, "snapshot.sqlite");
		const existingSelection = join(existingRoot, "selection.json");
		createSnapshot(existingSnapshot, [
			{ entity_id: "dense-a", region_id: 9, timestamp_ts: Date.parse("2026-08-16T10:00:00.000Z"), username_raw: "r9/alpha", username: "Alpha", text: "First retained line" },
		]);
		await writeSelection(existingSelection, {
			version: 1,
			id: "synthetic-production-corpus",
			snapshot_sha256: await sha256(await readFile(existingSnapshot)),
			evidence_date: "2026-08-16",
			cases: [{ ordinal: 1, id: "single-case", active_region_id: "9", windows: [{ start_utc: "2026-08-16T10:00:00.000Z", end_utc: "2026-08-16T10:01:00.000Z" }], expected_raw_count: 1, expected_prepared_count: 1 }],
		});
		await mkdir(resolve(existingLocalDataRoot, "corpus-workspaces", "synthetic-production-corpus"), { recursive: true });
		await expectTypedFailure({ snapshotPath: existingSnapshot, selectionPath: existingSelection, localDataRoot: existingLocalDataRoot }, "workspace_exists");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("direct corpus extraction verifier passes", async () => {
	const root = await mkdtemp(join(tmpdir(), "bc-news-corpus-extraction-verifier-"));
	try {
		await expect(verifyEvaluationCorpusExtraction(root)).resolves.toBe("EVALUATION CORPUS EXTRACTION VERIFIED");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}, 90_000);
