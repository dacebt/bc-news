import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
	EvidenceFixtureSchema,
	EvidenceMessageSchema,
	type EvidenceFixture,
	type EvidenceMessage,
} from "@bc-news/contracts";
import { prepareEvidence } from "@bc-news/generation-core";
import {
	derivePublicationDateForEvidenceDate,
	loadProductionCorpusSelection,
	type LoadedProductionCorpusSelection,
	type ProductionCorpusSelection,
} from "./evaluation-corpus-selection";
import {
	findPresentSnapshotSidecarPath,
	loadSnapshotQueryRows,
	SnapshotCorpusSqliteError,
	type SnapshotQueryRow,
} from "./evaluation-snapshot-corpus";

interface ExtractionCaseStage {
	readonly ordinal: number;
	readonly id: string;
	readonly activeRegionId: string;
	readonly evidencePath: string;
	readonly fixture: EvidenceFixture;
	readonly fixtureBytes: Uint8Array;
	readonly rawCount: number;
	readonly preparedCount: number;
}

export interface ProductionCorpusExtractionCaseResult {
	readonly ordinal: number;
	readonly id: string;
	readonly activeRegionId: string;
	readonly evidencePath: string;
	readonly rawCount: number;
	readonly preparedCount: number;
}

export interface ProductionCorpusExtractionResult {
	readonly selectionId: string;
	readonly workspacePath: string;
	readonly snapshotPath: string;
	readonly selectionPath: string;
	readonly snapshotSha256: string;
	readonly copiedSnapshotSha256: string;
	readonly selectionSha256: string;
	readonly cases: readonly ProductionCorpusExtractionCaseResult[];
	readonly totalRawCount: number;
	readonly totalPreparedCount: number;
}

type ExtractProductionCorpusInput = Readonly<{ snapshotPath: string; selectionPath: string; localDataRoot: string }>;

interface ExtractionWorkspaceStage {
	readonly workspacePath: string;
	readonly snapshotPath: string;
	readonly selectionPath: string;
	readonly finalWorkspacePath: string;
	readonly stageRoot: string;
	readonly stagedSnapshotPath: string;
	readonly snapshotSha256: string;
	readonly copiedSnapshotSha256: string;
	readonly selectionSha256: string;
}

interface ProductionCorpusExtractionHooks {
	readonly afterSnapshotStaged?: (context: {
		readonly sourceSnapshotPath: string;
		readonly stagedSnapshotPath: string;
		readonly stageRoot: string;
	}) => Promise<void> | void;
}

type ProductionCorpusExtractionErrorCode =
	| "snapshot_unreadable"
	| "snapshot_digest_mismatch"
	| "snapshot_sidecar_present"
	| "snapshot_open_failed"
	| "snapshot_query_failed"
	| "snapshot_row_rejected"
	| "extraction_prepare_rejected"
	| "extraction_count_mismatch"
	| "workspace_exists"
	| "workspace_publish_failed";

export class ProductionCorpusExtractionError extends Error {
	readonly code: ProductionCorpusExtractionErrorCode;
	readonly path: string;

	constructor(code: ProductionCorpusExtractionErrorCode, path: string, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "ProductionCorpusExtractionError";
		this.code = code;
		this.path = path;
	}
}

function hash(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function serializeJson(value: unknown): Uint8Array {
	return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function toEvidenceMessage(row: SnapshotQueryRow, snapshotPath: string): EvidenceMessage {
	const parsed = EvidenceMessageSchema.safeParse({
		id: row.entity_id,
		ts: row.timestamp_ts,
		author_id: row.username_raw,
		author_name: row.username,
		text: row.text,
	});
	if (!parsed.success) {
		throw new ProductionCorpusExtractionError(
			"snapshot_row_rejected",
			snapshotPath,
			`Snapshot storage row rejected the evidence message contract for case ${row.case_id}`,
			{ cause: parsed.error },
		);
	}
	return parsed.data;
}

async function loadSelectedCaseStages(snapshotPath: string, selection: ProductionCorpusSelection): Promise<readonly ExtractionCaseStage[]> {
	const grouped = new Map<number, { entry: ProductionCorpusSelection["cases"][number]; messages: EvidenceMessage[] }>(
		selection.cases.map((entry) => [entry.ordinal, { entry, messages: [] }]),
	);
	let rows: readonly SnapshotQueryRow[];
	try {
		rows = await loadSnapshotQueryRows(snapshotPath, selection);
	} catch (cause) {
		if (cause instanceof SnapshotCorpusSqliteError) {
			throw new ProductionCorpusExtractionError(cause.code, cause.path, cause.message, { cause });
		}
		throw cause;
	}
	for (const row of rows) {
		const group = grouped.get(row.case_ordinal);
		if (group === undefined) {
			throw new ProductionCorpusExtractionError("snapshot_query_failed", snapshotPath, `Snapshot query returned an unknown case ordinal for ${snapshotPath}`);
		}
		group.messages.push(toEvidenceMessage(row, snapshotPath));
	}
	let publicationDate: string;
	try {
		publicationDate = derivePublicationDateForEvidenceDate(selection.evidence_date);
	} catch (cause) {
		throw new ProductionCorpusExtractionError(
			"extraction_prepare_rejected",
			selection.evidence_date,
			`Cannot derive the canonical publication date for evidence day ${selection.evidence_date}`,
			{ cause },
		);
	}
	return selection.cases.map((entry) => {
		const messages = grouped.get(entry.ordinal)?.messages ?? [];
		const rawCount = messages.length;
		let preparedCount: number;
		try {
			preparedCount = prepareEvidence({
				activeRegionId: entry.active_region_id,
				publicationDate,
				messages,
			}).final_count;
		} catch (cause) {
			throw new ProductionCorpusExtractionError(
				"extraction_prepare_rejected",
				snapshotPath,
				`Snapshot messages for case ${entry.id} failed the canonical evidence preparation path`,
				{ cause },
			);
		}
		if (rawCount !== entry.expected_raw_count || preparedCount !== entry.expected_prepared_count) {
			throw new ProductionCorpusExtractionError(
				"extraction_count_mismatch",
				snapshotPath,
				`Selection counts mismatch for case ${entry.id}: expected raw=${entry.expected_raw_count} prepared=${entry.expected_prepared_count}, observed raw=${rawCount} prepared=${preparedCount}`,
			);
		}
		const fixture = EvidenceFixtureSchema.parse({
			active_region_id: entry.active_region_id,
			evidence_date: selection.evidence_date,
			messages,
		});
		const evidencePath = `reference-corpus/evidence/${entry.id}.json`;
		return {
			ordinal: entry.ordinal,
			id: entry.id,
			activeRegionId: entry.active_region_id,
			evidencePath,
			fixture,
			fixtureBytes: serializeJson(fixture),
			rawCount,
			preparedCount,
		};
	});
}

async function assertWorkspaceMissing(path: string): Promise<void> {
	try {
		await access(path);
	} catch {
		return;
	}
	throw new ProductionCorpusExtractionError("workspace_exists", path, `Extraction workspace already exists: ${path}`);
}

async function removeStagingWorkspace(stageRoot: string): Promise<void> {
	try {
		await rm(stageRoot, { recursive: true, force: true });
	} catch {
		// Preserve the original extraction error when cleanup is best-effort.
	}
}

async function stageExtractionWorkspace(
	localDataRoot: string,
	loadedSelection: LoadedProductionCorpusSelection,
	snapshotBytes: Uint8Array,
	sourceSnapshotPath: string,
	hooks: ProductionCorpusExtractionHooks,
): Promise<ExtractionWorkspaceStage> {
	const workspacePath = `corpus-workspaces/${loadedSelection.selection.id}`;
	const snapshotPath = `${workspacePath}/snapshot.sqlite`;
	const selectionPath = `${workspacePath}/reference-corpus/selection.json`;
	const workspaceRoot = resolve(localDataRoot, "corpus-workspaces");
	const finalWorkspacePath = resolve(localDataRoot, workspacePath);
	await mkdir(workspaceRoot, { recursive: true });
	await assertWorkspaceMissing(finalWorkspacePath);
	const stageRoot = await mkdtemp(resolve(workspaceRoot, `.${loadedSelection.selection.id}-staging-`));
	try {
		await mkdir(resolve(stageRoot, "reference-corpus", "evidence"), { recursive: true });
		const stagedSnapshotPath = resolve(stageRoot, "snapshot.sqlite");
		await writeFile(stagedSnapshotPath, snapshotBytes);
		await writeFile(resolve(stageRoot, "reference-corpus", "selection.json"), loadedSelection.bytes);
		const copiedSnapshotBytes = await readFile(stagedSnapshotPath);
		const copiedSelectionBytes = await readFile(resolve(stageRoot, "reference-corpus", "selection.json"));
		const snapshotSha256 = hash(snapshotBytes);
		const copiedSnapshotSha256 = hash(copiedSnapshotBytes);
		if (copiedSnapshotSha256 !== snapshotSha256 || Buffer.compare(snapshotBytes, copiedSnapshotBytes) !== 0) {
			throw new ProductionCorpusExtractionError("workspace_publish_failed", finalWorkspacePath, "Staged snapshot copy bytes changed during extraction");
		}
		if (Buffer.compare(loadedSelection.bytes, copiedSelectionBytes) !== 0) {
			throw new ProductionCorpusExtractionError("workspace_publish_failed", finalWorkspacePath, "Staged selection bytes changed during extraction");
		}
		await hooks.afterSnapshotStaged?.({ sourceSnapshotPath, stagedSnapshotPath, stageRoot });
		return {
			workspacePath,
			snapshotPath,
			selectionPath,
			finalWorkspacePath,
			stageRoot,
			stagedSnapshotPath,
			snapshotSha256,
			copiedSnapshotSha256,
			selectionSha256: hash(loadedSelection.bytes),
		};
	} catch (error) {
		await removeStagingWorkspace(stageRoot);
		throw error;
	}
}

async function publishExtractionWorkspace(
	stage: ExtractionWorkspaceStage,
	loadedSelection: LoadedProductionCorpusSelection,
	stages: readonly ExtractionCaseStage[],
): Promise<ProductionCorpusExtractionResult> {
	for (const entry of stages) {
		await writeFile(resolve(stage.stageRoot, entry.evidencePath), entry.fixtureBytes);
	}
	try {
		await rename(stage.stageRoot, stage.finalWorkspacePath);
	} catch (cause) {
		throw new ProductionCorpusExtractionError("workspace_publish_failed", stage.finalWorkspacePath, `Cannot atomically publish extraction workspace: ${stage.finalWorkspacePath}`, { cause });
	}
	return {
		selectionId: loadedSelection.selection.id,
		workspacePath: stage.workspacePath,
		snapshotPath: stage.snapshotPath,
		selectionPath: stage.selectionPath,
		snapshotSha256: stage.snapshotSha256,
		copiedSnapshotSha256: stage.copiedSnapshotSha256,
		selectionSha256: stage.selectionSha256,
		cases: stages.map((entry) => ({
			ordinal: entry.ordinal,
			id: entry.id,
			activeRegionId: entry.activeRegionId,
			evidencePath: `${stage.workspacePath}/${entry.evidencePath}`,
			rawCount: entry.rawCount,
			preparedCount: entry.preparedCount,
		})),
		totalRawCount: stages.reduce((sum, entry) => sum + entry.rawCount, 0),
		totalPreparedCount: stages.reduce((sum, entry) => sum + entry.preparedCount, 0),
	};
}

export async function extractProductionCorpusWithHooks(
	input: ExtractProductionCorpusInput,
	hooks: ProductionCorpusExtractionHooks = {},
): Promise<ProductionCorpusExtractionResult> {
	const snapshotPath = resolve(input.snapshotPath);
	const localDataRoot = resolve(input.localDataRoot);
	const loadedSelection = await loadProductionCorpusSelection(resolve(input.selectionPath));
	const snapshotSidecarPath = await findPresentSnapshotSidecarPath(snapshotPath);
	if (snapshotSidecarPath !== undefined) {
		throw new ProductionCorpusExtractionError(
			"snapshot_sidecar_present",
			snapshotPath,
			`Snapshot sidecar ${snapshotSidecarPath} must not be present during extraction`,
		);
	}
	let snapshotBytes: Uint8Array;
	try {
		snapshotBytes = await readFile(snapshotPath);
	} catch (cause) {
		throw new ProductionCorpusExtractionError("snapshot_unreadable", snapshotPath, `Cannot read extraction snapshot: ${snapshotPath}`, { cause });
	}
	const snapshotSha256 = hash(snapshotBytes);
	if (snapshotSha256 !== loadedSelection.selection.snapshot_sha256) {
		throw new ProductionCorpusExtractionError(
			"snapshot_digest_mismatch",
			snapshotPath,
			`Snapshot sha256 mismatch for ${snapshotPath}: expected ${loadedSelection.selection.snapshot_sha256}, observed ${snapshotSha256}`,
		);
	}
	let stage: ExtractionWorkspaceStage | null = null;
	try {
		stage = await stageExtractionWorkspace(localDataRoot, loadedSelection, snapshotBytes, snapshotPath, hooks);
		const stages = await loadSelectedCaseStages(stage.stagedSnapshotPath, loadedSelection.selection);
		return await publishExtractionWorkspace(stage, loadedSelection, stages);
	} catch (error) {
		if (stage !== null) {
			await removeStagingWorkspace(stage.stageRoot);
		}
		throw error;
	}
}

export async function extractProductionCorpus(
	input: ExtractProductionCorpusInput,
): Promise<ProductionCorpusExtractionResult> {
	return extractProductionCorpusWithHooks(input);
}
