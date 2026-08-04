import { access, mkdir, readdir, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

async function exists(candidate: string): Promise<boolean> {
	try {
		await access(candidate);
		return true;
	} catch {
		return false;
	}
}

export function modelResponseBackupPath(targetDirectory: string): string {
	return `${targetDirectory}.backup`;
}

export async function recoverModelResponseDirectory(
	targetDirectory: string,
	validateDirectory: (directory: string) => Promise<void>,
): Promise<void> {
	const backupDirectory = modelResponseBackupPath(targetDirectory);
	const [targetExists, backupExists] = await Promise.all([
		exists(targetDirectory),
		exists(backupDirectory),
	]);
	if (!backupExists) return;
	if (!targetExists) {
		await rename(backupDirectory, targetDirectory);
		await validateDirectory(targetDirectory);
		return;
	}
	await validateDirectory(targetDirectory);
	await rm(backupDirectory, { recursive: true });
}

export async function createModelResponseStagingDirectory(
	targetDirectory: string,
): Promise<string> {
	const parent = path.dirname(targetDirectory);
	await mkdir(parent, { recursive: true });
	const stagingDirectory = path.join(
		parent,
		`.${path.basename(targetDirectory)}.staging-${randomUUID()}`,
	);
	await mkdir(stagingDirectory);
	return stagingDirectory;
}

export async function promoteModelResponseDirectory(
	stagingDirectory: string,
	targetDirectory: string,
): Promise<void> {
	const backupDirectory = modelResponseBackupPath(targetDirectory);
	const targetExists = await exists(targetDirectory);
	if (await exists(backupDirectory)) {
		throw new Error(`Recovery backup already exists: ${backupDirectory}`);
	}
	if (targetExists) await rename(targetDirectory, backupDirectory);
	try {
		await rename(stagingDirectory, targetDirectory);
	} catch (cause) {
		if (targetExists && !(await exists(targetDirectory))) {
			await rename(backupDirectory, targetDirectory);
		}
		throw cause;
	}
	if (targetExists) await rm(backupDirectory, { recursive: true });
}

export async function removeStagingDirectory(stagingDirectory: string): Promise<void> {
	if (await exists(stagingDirectory)) await rm(stagingDirectory, { recursive: true });
}

export async function modelResponseFileNames(directory: string): Promise<string[]> {
	return (await readdir(directory)).sort();
}
