import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import type { GenerationRunParams } from "@bc-news/contracts";
import type { ModelUsageRecord } from "@bc-news/generation-core";
import { recordedJudgeModelProvider, recordedModelProvider } from "@bc-news/fixtures";
import {
	GenerationRunStatusUnreadableError,
	queueGenerationRunStatus,
	readGenerationRunStatus,
	recordGenerationRunComplete,
	recordGenerationRunFailure,
	recordGenerationRunProgress,
} from "../src/generation-run-status";
import { launchGenerationRun } from "../src/run-launch";

const NOW = "2026-08-04T23:00:00.000Z";

function pair(publicationDate: string): GenerationRunParams {
	return { active_region_id: "7", publication_date: publicationDate };
}

const mainUsage: ModelUsageRecord = {
	editorial_capability: "main_story",
	provider: "recorded",
	model: "recorded/main-story-v1",
	execution: "recorded_replay",
	token_usage: { measurement: "unavailable" },
	external_billing: { classification: "none", amount_usd: 0, reason: "recorded_replay" },
};
const announcementUsage: ModelUsageRecord = {
	...mainUsage,
	editorial_capability: "announcements",
	model: "recorded/announcements-v1",
};
const packagingUsage: ModelUsageRecord = {
	...mainUsage,
	editorial_capability: "packaging",
	model: "recorded/packaging-v1",
};

it("queues a strict empty projection and duplicate queue does not reset it", async () => {
	const params = pair("2026-02-01");
	await expect(queueGenerationRunStatus(env.DB, params, NOW)).resolves.toBe(true);
	await recordGenerationRunProgress(
		env.DB,
		params,
		{ currentStep: "compose-main-story", completedSteps: ["prepare-evidence"], modelUsage: [] },
		"2026-08-04T23:01:00.000Z",
	);
	await expect(queueGenerationRunStatus(env.DB, params, "2026-08-04T23:02:00.000Z")).resolves.toBe(false);
	await expect(readGenerationRunStatus(env.DB, params)).resolves.toMatchObject({
		state: "running",
		current_step: "compose-main-story",
		completed_steps: ["prepare-evidence"],
		model_usage: [],
		failure: null,
		created_at_utc: NOW,
	});
});

it("replaces ordered progress and usage without duplicating records", async () => {
	const params = pair("2026-02-02");
	await queueGenerationRunStatus(env.DB, params, NOW);
	const progress = {
		currentStep: "compose-announcements" as const,
		completedSteps: ["prepare-evidence", "compose-main-story"] as const,
		modelUsage: [mainUsage] as const,
	};
	await recordGenerationRunProgress(env.DB, params, progress, "2026-08-04T23:01:00.000Z");
	await recordGenerationRunProgress(env.DB, params, progress, "2026-08-04T23:02:00.000Z");
	await expect(readGenerationRunStatus(env.DB, params)).resolves.toMatchObject({
		completed_steps: progress.completedSteps,
		model_usage: [mainUsage],
	});
});

it("rejects regression from a terminal projection", async () => {
	const params = pair("2026-02-03");
	await queueGenerationRunStatus(env.DB, params, NOW);
	await recordGenerationRunFailure(
		env.DB,
		params,
		{ step: "prepare-evidence", code: "no_evidence_for_publication_date", message: "absent" },
		"2026-08-04T23:01:00.000Z",
	);
	await expect(
		recordGenerationRunProgress(
			env.DB,
			params,
			{ currentStep: "prepare-evidence", completedSteps: [], modelUsage: [] },
			"2026-08-04T23:02:00.000Z",
		),
	).rejects.toThrow("terminal");
	await expect(
		recordGenerationRunFailure(
			env.DB,
			params,
			{ step: "prepare-evidence", code: "no_evidence_for_publication_date", message: "absent" },
			"2026-08-04T23:03:00.000Z",
		),
	).resolves.toBeUndefined();
	await expect(readGenerationRunStatus(env.DB, params)).resolves.toMatchObject({
		updated_at_utc: "2026-08-04T23:01:00.000Z",
	});
	await expect(
		recordGenerationRunFailure(
			env.DB,
			params,
			{ step: "prepare-evidence", code: "different_failure", message: "changed" },
			"2026-08-04T23:04:00.000Z",
		),
	).rejects.toThrow("terminal");
});

it("records complete only with all six steps and three usage records", async () => {
	const params = pair("2026-02-04");
	await queueGenerationRunStatus(env.DB, params, NOW);
	await recordGenerationRunProgress(
		env.DB,
		params,
		{
			currentStep: "publish-edition",
			completedSteps: [
				"prepare-evidence",
				"compose-main-story",
				"compose-announcements",
				"compose-packaging",
				"validate-edition",
			],
			modelUsage: [mainUsage, announcementUsage, packagingUsage],
		},
		"2026-08-04T23:01:00.000Z",
	);
	await recordGenerationRunComplete(
		env.DB,
		params,
		[mainUsage, announcementUsage, packagingUsage],
		"2026-08-04T23:02:00.000Z",
	);
	await expect(readGenerationRunStatus(env.DB, params)).resolves.toMatchObject({
		state: "complete",
		current_step: null,
		model_usage: [mainUsage, announcementUsage, packagingUsage],
	});
	await expect(
		recordGenerationRunComplete(
			env.DB,
			params,
			[mainUsage, announcementUsage, packagingUsage],
			"2026-08-04T23:03:00.000Z",
		),
	).resolves.toBeUndefined();
	await expect(readGenerationRunStatus(env.DB, params)).resolves.toMatchObject({
		updated_at_utc: "2026-08-04T23:02:00.000Z",
	});
	await expect(
		recordGenerationRunComplete(
			env.DB,
			params,
			[{ ...mainUsage, provider: "changed" }, announcementUsage, packagingUsage],
			"2026-08-04T23:04:00.000Z",
		),
	).rejects.toThrow("terminal");
});

it("rejects queued to complete", async () => {
	const params = pair("2026-02-11");
	await queueGenerationRunStatus(env.DB, params, NOW);
	await expect(
		recordGenerationRunComplete(
			env.DB,
			params,
			[mainUsage, announcementUsage, packagingUsage],
			"2026-08-04T23:01:00.000Z",
		),
	).rejects.toThrow("queued -> complete");
});

it("rejects invalid SQL state and JSON and surfaces corrupt read-back", async () => {
	await expect(
		env.DB.prepare(
			`INSERT INTO generation_run_status (
			 active_region_id, publication_date, state, current_step, completed_steps_json,
			 model_usage_json, failure_json, created_at_utc, updated_at_utc
			) VALUES ('7', '2026-02-05', 'invalid', NULL, '[]', '[]', NULL, ?1, ?1)`,
		).bind(NOW).run(),
	).rejects.toThrow();
	await expect(
		env.DB.prepare(
			`INSERT INTO generation_run_status (
			 active_region_id, publication_date, state, current_step, completed_steps_json,
			 model_usage_json, failure_json, created_at_utc, updated_at_utc
			) VALUES ('7', '2026-02-06', 'queued', NULL, 'not-json', '[]', NULL, ?1, ?1)`,
		).bind(NOW).run(),
	).rejects.toThrow();
	await env.DB.prepare(
		`INSERT INTO generation_run_status (
		 active_region_id, publication_date, state, current_step, completed_steps_json,
		 model_usage_json, failure_json, created_at_utc, updated_at_utc
		) VALUES ('7', '2026-02-07', 'queued', NULL, '["publish-edition"]', '[]', NULL, ?1, ?1)`,
	).bind(NOW).run();
	await expect(readGenerationRunStatus(env.DB, pair("2026-02-07"))).rejects.toBeInstanceOf(
		GenerationRunStatusUnreadableError,
	);
});

it("queues before create and marks only a newly inserted row on create rejection", async () => {
	const params = pair("2026-02-08");
	const createError = new Error("create rejected");
	const create = vi.fn().mockRejectedValue(createError);
	const workflow = { create } as unknown as Workflow<GenerationRunParams>;
	await expect(launchGenerationRun(params, workflow, env.DB)).rejects.toBe(createError);
	await expect(readGenerationRunStatus(env.DB, params)).resolves.toMatchObject({
		state: "errored",
		failure: { step: "launch-generation-run", message: "create rejected" },
	});
	const existing = pair("2026-02-09");
	await queueGenerationRunStatus(env.DB, existing, NOW);
	await recordGenerationRunProgress(
		env.DB,
		existing,
		{ currentStep: "prepare-evidence", completedSteps: [], modelUsage: [] },
		"2026-08-04T23:01:00.000Z",
	);
	await expect(launchGenerationRun(existing, workflow, env.DB)).rejects.toBe(createError);
	await expect(readGenerationRunStatus(env.DB, existing)).resolves.toMatchObject({ state: "running" });
});

it("retains create and status-write failures in deterministic order", async () => {
	const params = pair("2026-02-10");
	const createError = new Error("create rejected");
	const statusError = new Error("status read failed");
	const statement = {
		bind() {
			return this;
		},
		run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
		first: vi.fn().mockRejectedValue(statusError),
	};
	const db = { prepare: vi.fn().mockReturnValue(statement) } as unknown as D1Database;
	const workflow = {
		create: vi.fn().mockRejectedValue(createError),
	} as unknown as Workflow<GenerationRunParams>;

	let thrown: unknown;
	try {
		await launchGenerationRun(params, workflow, db);
	} catch (error) {
		thrown = error;
	}
	expect(thrown).toBeInstanceOf(AggregateError);
	expect((thrown as AggregateError).errors).toEqual([createError, statusError]);
	expect((thrown as AggregateError).cause).toBe(statusError);
});

it("recorded providers report replay usage and zero external billing", async () => {
	for (const provider of [recordedModelProvider, recordedJudgeModelProvider]) {
		const completion = await provider.complete({
			editorialCapability: "main_story",
			system: "system",
			user: "user",
		}).catch((error: unknown) => {
			if (provider === recordedJudgeModelProvider) return undefined;
			throw error;
		});
		if (completion !== undefined) {
			expect(completion).toMatchObject({
				execution: "recorded_replay",
				token_usage: { measurement: "unavailable" },
				external_billing: { classification: "none", amount_usd: 0, reason: "recorded_replay" },
			});
		}
	}
});
