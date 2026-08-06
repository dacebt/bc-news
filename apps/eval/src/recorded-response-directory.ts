import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
	RecordedModelResponseSchema,
	type RecordedModelResponse,
	type RecordedModelResponseRoster,
} from "@bc-news/fixtures";
import { PRODUCTION_MODEL_STEPS, type ProductionModelStep } from "@bc-news/generation-core";
import { z } from "zod";

const RecorderLockOwnerSchema = z.strictObject({
	pid: z.number().int().positive(),
	nonce: z.string().uuid(),
	acquired_at: z.string().datetime(),
});

type RecorderLockOwner = z.infer<typeof RecorderLockOwnerSchema>;

export class RecordedResponseDirectoryError extends Error {
	readonly code:
		| "recorded_response_directory_rejected"
		| "recording_in_progress"
		| "recorder_lock_rejected"
		| "recording_recovery_failed"
		| "recording_promotion_failed";
	readonly path: string;

	constructor(
		code: RecordedResponseDirectoryError["code"],
		path: string,
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "RecordedResponseDirectoryError";
		this.code = code;
		this.path = path;
	}
}

export interface RecorderLockLease {
	readonly targetDirectory: string;
	readonly nonce: string;
	release(): Promise<void>;
}

function responseFileName(productionStep: ProductionModelStep): string {
	return `${productionStep}.json`;
}

function siblingPath(target: string, suffix: string): string {
	return join(dirname(target), `${basename(target)}.${suffix}`);
}

function backupPath(target: string): string {
	return siblingPath(target, "recording-backup");
}

function lockPath(target: string): string {
	return siblingPath(target, "recording-lock");
}

function stagingPrefix(target: string): string {
	return `${basename(target)}.recording-staging-`;
}

function isStagingDirectoryName(target: string, name: string): boolean {
	const prefix = stagingPrefix(target);
	if (!name.startsWith(prefix)) return false;
	return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
		name.slice(prefix.length),
	);
}

function errorCode(error: unknown): string | undefined {
	if (!(error instanceof Error)) return undefined;
	if ("code" in error && typeof error.code === "string") return error.code;
	return "cause" in error ? errorCode(error.cause) : undefined;
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await readdir(path);
		return true;
	} catch (error) {
		if (errorCode(error) === "ENOENT") return false;
		if (errorCode(error) === "ENOTDIR") return true;
		throw error;
	}
}

async function readRecordedResponse(path: string, productionStep: ProductionModelStep): Promise<RecordedModelResponse> {
	let candidate: unknown;
	try {
		candidate = JSON.parse(await readFile(path, "utf8"));
	} catch (cause) {
		throw new RecordedResponseDirectoryError(
			"recorded_response_directory_rejected",
			path,
			`Recorded response at ${path} is not valid JSON`,
			{ cause },
		);
	}
	const result = RecordedModelResponseSchema.safeParse(candidate);
	if (!result.success) {
		throw new RecordedResponseDirectoryError(
			"recorded_response_directory_rejected",
			path,
			`Recorded response at ${path} does not match the strict schema: ${result.error.message}`,
		);
	}
	if (result.data.production_step !== productionStep) {
		throw new RecordedResponseDirectoryError(
			"recorded_response_directory_rejected",
			path,
			`Recorded response filename declares ${productionStep} but content declares ${result.data.production_step}`,
		);
	}
	return result.data;
}

export async function validateRecordedResponseDirectory(
	directory: string,
): Promise<RecordedModelResponseRoster> {
	let entries;
	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch (cause) {
		throw new RecordedResponseDirectoryError(
			"recorded_response_directory_rejected",
			directory,
			`Recorded response directory ${directory} is unavailable`,
			{ cause },
		);
	}
	const expectedNames = new Set(PRODUCTION_MODEL_STEPS.map(responseFileName));
	const actualNames = new Set(entries.map((entry) => entry.name));
	const unexpected = entries.filter((entry) => !expectedNames.has(entry.name) || !entry.isFile());
	const missing = [...expectedNames].filter((name) => !actualNames.has(name));
	if (unexpected.length > 0 || missing.length > 0 || entries.length !== expectedNames.size) {
		throw new RecordedResponseDirectoryError(
			"recorded_response_directory_rejected",
			directory,
			`Recorded response directory must contain exactly ${[...expectedNames].join(", ")}; missing=${missing.join(",") || "none"}; unexpected=${unexpected.map((entry) => entry.name).join(",") || "none"}`,
		);
	}
	const [mainStoryWrite, mainStoryCopyedit, announcementsWrite, announcementsCopyedit] = await Promise.all([
		readRecordedResponse(join(directory, responseFileName("main_story_write")), "main_story_write"),
		readRecordedResponse(join(directory, responseFileName("main_story_copyedit")), "main_story_copyedit"),
		readRecordedResponse(join(directory, responseFileName("announcements_write")), "announcements_write"),
		readRecordedResponse(
			join(directory, responseFileName("announcements_copyedit")),
			"announcements_copyedit",
		),
	]);
	return {
		main_story_write: mainStoryWrite,
		main_story_copyedit: mainStoryCopyedit,
		announcements_write: announcementsWrite,
		announcements_copyedit: announcementsCopyedit,
	};
}

export async function createRecordedResponseStagingDirectory(target: string): Promise<string> {
	const staging = siblingPath(target, `recording-staging-${randomUUID()}`);
	await mkdir(staging);
	return staging;
}

async function quarantine(path: string): Promise<string> {
	const destination = siblingPath(path, `quarantine-${randomUUID()}`);
	await rename(path, destination);
	return destination;
}

async function isValidDirectory(path: string): Promise<boolean> {
	if (!(await pathExists(path))) return false;
	try {
		await validateRecordedResponseDirectory(path);
		return true;
	} catch {
		return false;
	}
}

async function quarantineAbandonedStagingDirectories(target: string): Promise<void> {
	const entries = await readdir(dirname(target), { withFileTypes: true });
	for (const entry of entries) {
		if (isStagingDirectoryName(target, entry.name)) {
			await quarantine(join(dirname(target), entry.name));
		}
	}
}

export async function recoverRecordedResponseDirectory(target: string): Promise<void> {
	await quarantineAbandonedStagingDirectories(target);
	const backup = backupPath(target);
	const targetExists = await pathExists(target);
	const backupExists = await pathExists(backup);
	if (!targetExists && !backupExists) return;

	const targetValid = targetExists && await isValidDirectory(target);
	const backupValid = backupExists && await isValidDirectory(backup);
	if (targetValid) {
		if (backupExists) {
			if (backupValid) await rm(backup, { recursive: true });
			else await quarantine(backup);
		}
		return;
	}
	if (backupValid) {
		if (targetExists) await quarantine(target);
		await rename(backup, target);
		await validateRecordedResponseDirectory(target);
		return;
	}
	if (targetExists) await quarantine(target);
	if (backupExists) await quarantine(backup);
	throw new RecordedResponseDirectoryError(
		"recording_recovery_failed",
		target,
		`Neither the recorded response target nor its backup is a valid four-response set`,
	);
}

async function readLockOwner(path: string): Promise<RecorderLockOwner> {
	let candidate: unknown;
	try {
		candidate = JSON.parse(await readFile(join(path, "owner.json"), "utf8"));
	} catch (cause) {
		throw new RecordedResponseDirectoryError(
			"recorder_lock_rejected",
			path,
			`Recorder lock owner metadata at ${path} is unreadable`,
			{ cause },
		);
	}
	const result = RecorderLockOwnerSchema.safeParse(candidate);
	if (!result.success) {
		throw new RecordedResponseDirectoryError(
			"recorder_lock_rejected",
			path,
			`Recorder lock owner metadata at ${path} is invalid: ${result.error.message}`,
		);
	}
	return result.data;
}

function ownerPidIsLive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return errorCode(error) !== "ESRCH";
	}
}

export async function acquireRecorderLock(target: string): Promise<RecorderLockLease> {
	const fixedLock = lockPath(target);
	while (true) {
		const owner = { pid: process.pid, nonce: randomUUID(), acquired_at: new Date().toISOString() };
		const preparedLock = siblingPath(target, `recording-lock-prepared-${owner.nonce}`);
		await mkdir(preparedLock);
		await writeFile(join(preparedLock, "owner.json"), `${JSON.stringify(owner)}\n`, { flag: "wx" });
		try {
			await rename(preparedLock, fixedLock);
		} catch (cause) {
			await rm(preparedLock, { recursive: true, force: true });
			if (!["EEXIST", "ENOTEMPTY"].includes(errorCode(cause) ?? "")) throw cause;
			let existingOwner: RecorderLockOwner;
			try {
				existingOwner = await readLockOwner(fixedLock);
			} catch (error) {
				if (errorCode(error) === "ENOENT") continue;
				throw error;
			}
			if (ownerPidIsLive(existingOwner.pid)) {
				throw new RecordedResponseDirectoryError(
					"recording_in_progress",
					fixedLock,
					`A recorder process with PID ${existingOwner.pid} already owns ${fixedLock}`,
				);
			}
			try {
				await rename(fixedLock, siblingPath(target, `recording-lock-quarantine-${existingOwner.nonce}`));
			} catch (error) {
				if (["ENOENT", "EEXIST", "ENOTEMPTY"].includes(errorCode(error) ?? "")) continue;
				throw error;
			}
			continue;
		}

		return {
			targetDirectory: target,
			nonce: owner.nonce,
			async release(): Promise<void> {
				const currentOwner = await readLockOwner(fixedLock);
				if (currentOwner.nonce !== owner.nonce) {
					throw new RecordedResponseDirectoryError(
						"recorder_lock_rejected",
						fixedLock,
						`Recorder lock ownership changed before release`,
					);
				}
				await rm(fixedLock, { recursive: true });
			},
		};
	}
}

export async function promoteRecordedResponseDirectory(input: {
	readonly stagingDirectory: string;
	readonly targetDirectory: string;
}): Promise<void> {
	await validateRecordedResponseDirectory(input.stagingDirectory);
	const backup = backupPath(input.targetDirectory);
	if (await pathExists(backup)) {
		throw new RecordedResponseDirectoryError(
			"recording_promotion_failed",
			backup,
			`Recorder backup already exists; recovery must complete before promotion`,
		);
	}
	const hadTarget = await pathExists(input.targetDirectory);
	if (hadTarget) await validateRecordedResponseDirectory(input.targetDirectory);

	try {
		if (hadTarget) await rename(input.targetDirectory, backup);
		await rename(input.stagingDirectory, input.targetDirectory);
		await validateRecordedResponseDirectory(input.targetDirectory);
		if (hadTarget) await rm(backup, { recursive: true });
	} catch (cause) {
		if (await isValidDirectory(backup)) {
			if (await pathExists(input.targetDirectory)) await quarantine(input.targetDirectory);
			await rename(backup, input.targetDirectory);
			await validateRecordedResponseDirectory(input.targetDirectory);
		}
		throw new RecordedResponseDirectoryError(
			"recording_promotion_failed",
			input.targetDirectory,
			`Recorded response promotion did not complete`,
			{ cause },
		);
	}
}

export async function removeRecordedResponseStagingDirectory(staging: string): Promise<void> {
	await rm(staging, { recursive: true, force: true });
}
