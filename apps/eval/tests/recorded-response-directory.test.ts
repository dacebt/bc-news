import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type {
	RecordedModelResponseRoster,
	RecordedModelResponseV2Roster,
	RecordedModelResponseV3Roster,
} from "@bc-news/fixtures";
import { PRODUCTION_MODEL_STEPS, type ProductionModelStep } from "@bc-news/generation-core";
import { expect, test } from "vitest";
import {
	acquireRecorderLock,
	createRecordedResponseStagingDirectory,
	promoteRecordedResponseDirectory,
	recoverRecordedResponseDirectory,
	validateRecordedResponseDirectory,
} from "../src/recorded-response-directory";

function roster(marker: string): RecordedModelResponseRoster {
	const response = (productionStep: ProductionModelStep) => ({
		production_step: productionStep,
		provider: `provider-${marker}`,
		model: `model-${marker}`,
		prompt_sha256: marker.repeat(64),
		text: `response-${productionStep}-${marker}`,
	});
	return {
		main_story_write: response("main_story_write"),
		main_story_copyedit: response("main_story_copyedit"),
		announcements_write: response("announcements_write"),
		announcements_copyedit: response("announcements_copyedit"),
	};
}

function currentRoster(marker: string): RecordedModelResponseV3Roster {
	const response = (productionStep: ProductionModelStep) => ({
		version: 3 as const,
		production_step: productionStep,
		provider: `provider-${marker}`,
		model: `model-${marker}`,
		prompt_sha256: marker.repeat(64),
		text: `response-${productionStep}-${marker}`,
		configuration: {
			adapter: "lmstudio" as const,
			model: `model-${marker}-${productionStep}`,
			temperature: productionStep === "main_story_write" ? 0.7 : 0.2,
			reasoning_effort: "provider_default" as const,
		},
	});
	return {
		main_story_write: response("main_story_write"),
		main_story_copyedit: response("main_story_copyedit"),
		announcements_write: response("announcements_write"),
		announcements_copyedit: response("announcements_copyedit"),
	};
}

function historicalV2Roster(marker: string): RecordedModelResponseV2Roster {
	const response = (productionStep: ProductionModelStep) => ({
		version: 2 as const,
		production_step: productionStep,
		provider: `provider-${marker}`,
		model: `model-${marker}`,
		prompt_sha256: marker.repeat(64),
		text: `response-${productionStep}-${marker}`,
		sampling: {
			adapter: "lmstudio" as const,
			posture: "explicit" as const,
			config: { temperature: 0.5, top_p: 0.9, top_k: 30 },
		},
	});
	return {
		main_story_write: response("main_story_write"),
		main_story_copyedit: response("main_story_copyedit"),
		announcements_write: response("announcements_write"),
		announcements_copyedit: response("announcements_copyedit"),
	};
}

async function writeRoster(directory: string, marker: string, create = true): Promise<void> {
	if (create) await mkdir(directory);
	const responses = roster(marker);
	await Promise.all(PRODUCTION_MODEL_STEPS.map((step) =>
		writeFile(join(directory, `${step}.json`), `${JSON.stringify(responses[step])}\n`),
	));
}

async function writeCurrentRoster(directory: string, marker: string, create = true): Promise<void> {
	if (create) await mkdir(directory);
	const responses = currentRoster(marker);
	await Promise.all(PRODUCTION_MODEL_STEPS.map((step) =>
		writeFile(join(directory, `${step}.json`), `${JSON.stringify(responses[step])}\n`),
	));
}

test("rejects missing, extra, directory, and filename-step response entries", async () => {
	const root = await mkdtemp(join(tmpdir(), "bc-news-recorded-validation-"));
	const directory = join(root, "responses");
	await writeRoster(directory, "a");
	await writeFile(join(directory, "extra.json"), "{}\n");
	await expect(validateRecordedResponseDirectory(directory)).rejects.toMatchObject({
		code: "recorded_response_directory_rejected",
	});

	const mismatchDirectory = join(root, "mismatch");
	await writeRoster(mismatchDirectory, "b");
	await writeFile(
		join(mismatchDirectory, "main_story_write.json"),
		`${JSON.stringify(roster("b").main_story_copyedit)}\n`,
	);
	await expect(validateRecordedResponseDirectory(mismatchDirectory)).rejects.toMatchObject({
		code: "recorded_response_directory_rejected",
	});

	const directoryEntry = join(root, "directory-entry");
	await writeRoster(directoryEntry, "c");
	await writeFile(join(directoryEntry, "announcements_copyedit.json"), "");
	await mkdir(join(directoryEntry, "unexpected"));
	await expect(validateRecordedResponseDirectory(directoryEntry)).rejects.toMatchObject({
		code: "recorded_response_directory_rejected",
	});
});

test("preserves abandoned staging bytes in a quarantine sibling", async () => {
	const root = await mkdtemp(join(tmpdir(), "bc-news-recorded-abandoned-"));
	const target = join(root, "responses");
	const lease = await acquireRecorderLock(target);
	try {
		const staging = await createRecordedResponseStagingDirectory(target);
		await writeFile(join(staging, "partial.json"), "partial bytes");
		await recoverRecordedResponseDirectory(target);

		const quarantinedName = (await readdir(root)).find((name) =>
			name.startsWith(`${basename(staging)}.quarantine-`),
		);
		expect(quarantinedName).toBeDefined();
		expect(await readFile(join(root, quarantinedName ?? "", "partial.json"), "utf8"))
			.toBe("partial bytes");
	} finally {
		await lease.release();
	}
});

test("restores a valid backup and quarantines an invalid target", async () => {
	const root = await mkdtemp(join(tmpdir(), "bc-news-recorded-recovery-"));
	const target = join(root, "responses");
	const backup = join(root, "responses.recording-backup");
	await mkdir(target);
	await writeFile(join(target, "invalid.txt"), "preserve me");
	await writeRoster(backup, "d");
	const lease = await acquireRecorderLock(target);
	try {
		await recoverRecordedResponseDirectory(target);
		expect((await validateRecordedResponseDirectory(target)).main_story_write.provider)
			.toBe("provider-d");
		const quarantinedName = (await readdir(root)).find((name) =>
			name.startsWith("responses.quarantine-"),
		);
		expect(quarantinedName).toBeDefined();
		expect(await readFile(join(root, quarantinedName ?? "", "invalid.txt"), "utf8"))
			.toBe("preserve me");
	} finally {
		await lease.release();
	}
});

test("quarantines an invalid target before rejecting recovery", async () => {
	const root = await mkdtemp(join(tmpdir(), "bc-news-recorded-invalid-target-"));
	const target = join(root, "responses");
	await mkdir(target);
	await writeFile(join(target, "invalid.txt"), "invalid target bytes");

	await expect(recoverRecordedResponseDirectory(target)).rejects.toMatchObject({
		code: "recording_recovery_failed",
	});
	const entries = await readdir(root);
	const quarantineName = entries.find((name) => name.startsWith("responses.quarantine-"));
	expect(entries).not.toContain("responses");
	expect(quarantineName).toBeDefined();
	expect(await readFile(join(root, quarantineName ?? "", "invalid.txt"), "utf8"))
		.toBe("invalid target bytes");
	await expect(recoverRecordedResponseDirectory(target)).resolves.toBeUndefined();
});

test("quarantines invalid target and backup before rejecting recovery", async () => {
	const root = await mkdtemp(join(tmpdir(), "bc-news-recorded-invalid-pair-"));
	const target = join(root, "responses");
	const backup = join(root, "responses.recording-backup");
	await mkdir(target);
	await mkdir(backup);
	await writeFile(join(target, "invalid.txt"), "invalid target bytes");
	await writeFile(join(backup, "invalid.txt"), "invalid backup bytes");

	await expect(recoverRecordedResponseDirectory(target)).rejects.toMatchObject({
		code: "recording_recovery_failed",
	});
	const entries = await readdir(root);
	const targetQuarantine = entries.find((name) => name.startsWith("responses.quarantine-"));
	const backupQuarantine = entries.find((name) =>
		name.startsWith("responses.recording-backup.quarantine-"),
	);
	expect(entries).not.toContain("responses");
	expect(entries).not.toContain("responses.recording-backup");
	expect(await readFile(join(root, targetQuarantine ?? "", "invalid.txt"), "utf8"))
		.toBe("invalid target bytes");
	expect(await readFile(join(root, backupQuarantine ?? "", "invalid.txt"), "utf8"))
		.toBe("invalid backup bytes");
	await expect(recoverRecordedResponseDirectory(target)).resolves.toBeUndefined();
});

test("promotes a validated staging set and removes the superseded backup", async () => {
	const root = await mkdtemp(join(tmpdir(), "bc-news-recorded-promotion-"));
	const target = join(root, "responses");
	await writeRoster(target, "e");
	const lease = await acquireRecorderLock(target);
	try {
		await recoverRecordedResponseDirectory(target);
		const staging = await createRecordedResponseStagingDirectory(target);
		await writeCurrentRoster(staging, "f", false);
		await promoteRecordedResponseDirectory({ stagingDirectory: staging, targetDirectory: target });

		const promoted = (await validateRecordedResponseDirectory(target)).announcements_copyedit;
		expect(promoted.provider).toBe("provider-f");
		expect("version" in promoted && promoted.version).toBe(3);
		expect("configuration" in promoted && promoted.configuration).toEqual({
			adapter: "lmstudio",
			model: "model-f-announcements_copyedit",
			temperature: 0.2,
			reasoning_effort: "provider_default",
		});
		expect(await readdir(root)).not.toContain("responses.recording-backup");
	} finally {
		await lease.release();
	}
});

test("rejects mixed LM Studio sampling postures in one version 2 response set", async () => {
	const root = await mkdtemp(join(tmpdir(), "bc-news-recorded-mixed-posture-"));
	const directory = join(root, "responses");
	await mkdir(directory);
	const historical = historicalV2Roster("a");
	await Promise.all(PRODUCTION_MODEL_STEPS.map((step) =>
		writeFile(join(directory, `${step}.json`), `${JSON.stringify(historical[step])}\n`),
	));
	const response = historical.main_story_write;
	await writeFile(join(directory, "main_story_write.json"), `${JSON.stringify({
		...response,
		sampling: { adapter: "lmstudio", posture: "provider_default" },
	})}\n`);

	await expect(validateRecordedResponseDirectory(directory)).rejects.toMatchObject({
		code: "recorded_response_directory_rejected",
		message: "All version 2 LM Studio responses must retain one sampling posture",
	});
});

test("rejects a second recorder while the live owner holds the lock", async () => {
	const root = await mkdtemp(join(tmpdir(), "bc-news-recorded-lock-"));
	const target = join(root, "responses");
	const lease = await acquireRecorderLock(target);
	try {
		await expect(acquireRecorderLock(target)).rejects.toMatchObject({ code: "recording_in_progress" });
	} finally {
		await lease.release();
	}
});

test("allows one stale-lock contender and rejects the other while preserving stale evidence", async () => {
	const root = await mkdtemp(join(tmpdir(), "bc-news-recorded-stale-lock-"));
	const target = join(root, "responses");
	const lock = join(root, "responses.recording-lock");
	await mkdir(lock);
	await writeFile(join(lock, "owner.json"), `${JSON.stringify({
		pid: 2_147_483_647,
		nonce: "00000000-0000-4000-8000-000000000000",
		acquired_at: "2026-08-06T00:00:00.000Z",
	})}\n`);

	const attempts = await Promise.allSettled([
		acquireRecorderLock(target),
		acquireRecorderLock(target),
	]);
	const leases = attempts.filter((attempt) => attempt.status === "fulfilled");
	const rejections = attempts.filter((attempt) => attempt.status === "rejected");
	expect(leases).toHaveLength(1);
	expect(rejections).toHaveLength(1);
	expect(rejections[0]).toMatchObject({ reason: { code: "recording_in_progress" } });

	if (leases[0]?.status !== "fulfilled") throw new Error("Expected one acquired recorder lease");
	await leases[0].value.release();
	expect(await readdir(root)).toEqual([
		"responses.recording-lock-quarantine-00000000-0000-4000-8000-000000000000",
	]);
	expect(JSON.parse(await readFile(join(
		root,
		"responses.recording-lock-quarantine-00000000-0000-4000-8000-000000000000",
		"owner.json",
	), "utf8"))).toMatchObject({ nonce: "00000000-0000-4000-8000-000000000000" });
});

test("leaves a lock in place when lease ownership changed", async () => {
	const root = await mkdtemp(join(tmpdir(), "bc-news-recorded-lock-owner-"));
	const target = join(root, "responses");
	const lock = join(root, "responses.recording-lock");
	const lease = await acquireRecorderLock(target);
	const replacementOwner = {
		pid: process.pid,
		nonce: "00000000-0000-4000-8000-000000000000",
		acquired_at: new Date().toISOString(),
	};
	await writeFile(join(lock, "owner.json"), `${JSON.stringify(replacementOwner)}\n`);

	await expect(lease.release()).rejects.toMatchObject({ code: "recorder_lock_rejected" });
	expect(JSON.parse(await readFile(join(lock, "owner.json"), "utf8"))).toEqual(replacementOwner);
	await rm(lock, { recursive: true });
});
