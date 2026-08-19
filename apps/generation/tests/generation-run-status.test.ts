import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import type { GenerationRunParams } from "@bc-news/contracts";
import {
	PRODUCTION_MODEL_STEPS,
	type EditorialDiagnostic,
	type ModelUsageRecord,
	type ProductionModelStep,
} from "@bc-news/generation-core";
import {
	GENERATION_STEPS,
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

function usage(productionStep: ProductionModelStep): ModelUsageRecord {
	return {
		production_step: productionStep,
		provider: "recorded",
		model: `recorded/${productionStep}`,
		execution: "recorded_replay",
		token_usage: { measurement: "unavailable" },
		external_billing: { classification: "none", amount_usd: 0, reason: "recorded_replay" },
	};
}

const allUsage = PRODUCTION_MODEL_STEPS.map(usage);

function diagnostic(
	productionStep: "main_story_copyedit" | "announcements_copyedit" = "main_story_copyedit",
): EditorialDiagnostic {
	return {
		kind: "preservation",
		production_step: productionStep,
		code: "paragraph_count",
		message: `Copyedit changed paragraph count in ${productionStep}`,
	};
}

it("queues an empty projection and duplicate queue does not reset progress", async () => {
	const params = pair("2026-02-01");
	await expect(queueGenerationRunStatus(env.DB, params, NOW)).resolves.toBe(true);
	await recordGenerationRunProgress(env.DB, params, {
		currentStep: "main_story_write",
		completedSteps: ["prepare-evidence"],
		modelUsage: [],
		diagnostics: [],
	}, "2026-08-04T23:01:00.000Z");
	await expect(queueGenerationRunStatus(env.DB, params, "2026-08-04T23:02:00.000Z")).resolves.toBe(false);
	await expect(readGenerationRunStatus(env.DB, params)).resolves.toMatchObject({
		state: "running",
		current_step: "main_story_write",
		completed_steps: ["prepare-evidence"],
		model_usage: [],
		diagnostics: [],
		created_at_utc: NOW,
	});
});

it("retains completed writer usage when the next copyedit is current", async () => {
	const params = pair("2026-02-02");
	await queueGenerationRunStatus(env.DB, params, NOW);
	const progress = {
		currentStep: "main_story_copyedit" as const,
		completedSteps: ["prepare-evidence", "main_story_write"] as const,
		modelUsage: [usage("main_story_write")] as const,
		diagnostics: [] as const,
	};
	await recordGenerationRunProgress(env.DB, params, progress, "2026-08-04T23:01:00.000Z");
	await recordGenerationRunProgress(env.DB, params, progress, "2026-08-04T23:02:00.000Z");
	await expect(readGenerationRunStatus(env.DB, params)).resolves.toMatchObject({
		completed_steps: progress.completedSteps,
		model_usage: progress.modelUsage,
	});
	await expect(recordGenerationRunProgress(env.DB, params, {
		...progress,
		modelUsage: [{ ...progress.modelUsage[0], provider: "replacement" }],
	}, "2026-08-04T23:03:00.000Z")).rejects.toThrow("cannot regress or replace");
});

it("rejects out-of-order, missing, or extra model usage", async () => {
	const params = pair("2026-02-03");
	await queueGenerationRunStatus(env.DB, params, NOW);
	const completedSteps = [
		"prepare-evidence",
		"main_story_write",
		"main_story_copyedit",
	] as const;
	for (const modelUsage of [
		[usage("main_story_copyedit"), usage("main_story_write")],
		[usage("main_story_write")],
		[usage("main_story_write"), usage("main_story_copyedit"), usage("announcements_write")],
	]) {
		await expect(recordGenerationRunProgress(env.DB, params, {
			currentStep: "announcements_write",
			completedSteps,
			modelUsage,
			diagnostics: [],
		}, "2026-08-04T23:01:00.000Z")).rejects.toThrow();
	}
});

it("records complete only with all seven steps and four ordered usages", async () => {
	const params = pair("2026-02-04");
	await queueGenerationRunStatus(env.DB, params, NOW);
	await recordGenerationRunProgress(env.DB, params, {
		currentStep: "publish-edition",
		completedSteps: GENERATION_STEPS.slice(0, -1),
		modelUsage: allUsage,
		diagnostics: [diagnostic(), diagnostic("announcements_copyedit")],
	}, "2026-08-04T23:01:00.000Z");
	const diagnostics = [diagnostic(), diagnostic("announcements_copyedit")];
	await recordGenerationRunComplete(env.DB, params, allUsage, diagnostics, "2026-08-04T23:02:00.000Z");
	await expect(readGenerationRunStatus(env.DB, params)).resolves.toMatchObject({
		state: "complete",
		current_step: null,
		completed_steps: GENERATION_STEPS,
		model_usage: allUsage,
		diagnostics,
	});
	await expect(
		recordGenerationRunComplete(env.DB, params, allUsage, diagnostics, "2026-08-04T23:03:00.000Z"),
	).resolves.toBeUndefined();
	await expect(recordGenerationRunComplete(
		env.DB,
		params,
		[{ ...usage("main_story_write"), provider: "changed" }, ...allUsage.slice(1)],
		diagnostics,
		"2026-08-04T23:04:00.000Z",
	)).rejects.toThrow("terminal");
});

it("retains completed steps, usages, and diagnostics on later failure", async () => {
	const params = pair("2026-02-05");
	await queueGenerationRunStatus(env.DB, params, NOW);
	const diagnostics = [diagnostic(), diagnostic("announcements_copyedit")];
	await recordGenerationRunProgress(env.DB, params, {
		currentStep: "publish-edition",
		completedSteps: GENERATION_STEPS.slice(0, -1),
		modelUsage: allUsage,
		diagnostics,
	}, "2026-08-04T23:01:00.000Z");
	await recordGenerationRunFailure(env.DB, params, {
		step: "publish-edition",
		code: "publish_failed",
		message: "edition store unavailable",
	}, "2026-08-04T23:02:00.000Z");
	await expect(readGenerationRunStatus(env.DB, params)).resolves.toMatchObject({
		state: "errored",
		completed_steps: GENERATION_STEPS.slice(0, -1),
		model_usage: allUsage,
		diagnostics,
		failure: { step: "publish-edition", code: "publish_failed" },
	});
});

it("rejects transition away from a terminal projection", async () => {
	const params = pair("2026-02-06");
	await queueGenerationRunStatus(env.DB, params, NOW);
	await recordGenerationRunFailure(env.DB, params, {
		step: "prepare-evidence",
		code: "no_evidence_for_publication_date",
		message: "absent",
	}, "2026-08-04T23:01:00.000Z");
	await expect(recordGenerationRunProgress(env.DB, params, {
		currentStep: "prepare-evidence",
		completedSteps: [],
		modelUsage: [],
		diagnostics: [],
	}, "2026-08-04T23:02:00.000Z")).rejects.toThrow("terminal");
});

it("rejects a queued run jumping directly to complete", async () => {
	const params = pair("2026-02-12");
	await queueGenerationRunStatus(env.DB, params, NOW);
	await expect(
		recordGenerationRunComplete(env.DB, params, allUsage, [], "2026-08-04T23:01:00.000Z"),
	).rejects.toThrow("queued -> complete");
});

it("rejects diagnostic regression, replacement, and out-of-order attribution", async () => {
	const params = pair("2026-02-16");
	await queueGenerationRunStatus(env.DB, params, NOW);
	const retained = diagnostic();
	const progress = {
		currentStep: "validate-edition" as const,
		completedSteps: GENERATION_STEPS.slice(0, 5),
		modelUsage: allUsage,
		diagnostics: [retained],
	};
	await recordGenerationRunProgress(env.DB, params, progress, "2026-08-04T23:01:00.000Z");
	await expect(recordGenerationRunProgress(env.DB, params, {
		...progress,
		diagnostics: [],
	}, "2026-08-04T23:02:00.000Z")).rejects.toThrow("cannot regress or replace");
	await expect(recordGenerationRunProgress(env.DB, params, {
		...progress,
		diagnostics: [{ ...retained, message: "replacement" }],
	}, "2026-08-04T23:03:00.000Z")).rejects.toThrow("cannot regress or replace");
	await expect(recordGenerationRunProgress(env.DB, params, {
		...progress,
		diagnostics: [diagnostic("announcements_copyedit"), retained],
	}, "2026-08-04T23:04:00.000Z")).rejects.toThrow("production step order");
});

it("surfaces corrupt stored JSON as unreadable status", async () => {
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

it("surfaces a non-contract stored diagnostic as unreadable status", async () => {
	const invalidDiagnostic = {
		kind: "preservation",
		production_step: "main_story_copyedit",
		code: "paragraph_count",
		message: "Copyedit changed paragraph count in main_story.body",
		path: "main_story.body",
	};
	await env.DB.prepare(
		`INSERT INTO generation_run_status (
		 active_region_id, publication_date, state, current_step, completed_steps_json,
		 model_usage_json, diagnostics_json, failure_json, created_at_utc, updated_at_utc
		) VALUES ('7', '2026-02-18', 'running', 'announcements_write', ?1, ?2, ?3, NULL, ?4, ?4)`,
	).bind(
		JSON.stringify(GENERATION_STEPS.slice(0, 3)),
		JSON.stringify(allUsage.slice(0, 2)),
		JSON.stringify([invalidDiagnostic]),
		NOW,
	).run();
	await expect(readGenerationRunStatus(env.DB, pair("2026-02-18"))).rejects.toBeInstanceOf(
		GenerationRunStatusUnreadableError,
	);
});

it("reopens a legacy Gateway usage record without exact policy fields", async () => {
	const params = pair("2026-02-19");
	await env.DB.prepare(
		`INSERT INTO generation_run_status (
		 active_region_id, publication_date, state, current_step, completed_steps_json,
		 model_usage_json, diagnostics_json, failure_json, created_at_utc, updated_at_utc
		) VALUES ('7', '2026-02-19', 'running', 'main_story_copyedit', ?1, ?2, '[]', NULL, ?3, ?3)`,
	).bind(
		JSON.stringify(GENERATION_STEPS.slice(0, 2)),
		JSON.stringify([{
			production_step: "main_story_write",
			provider: "google",
			model: "gemini-3.7-flash",
			execution: "hosted_inference",
			token_usage: { measurement: "reported", input_tokens: 100, output_tokens: 25, total_tokens: 125 },
			external_billing: { classification: "unavailable", reason: "provider_did_not_report_cost" },
			request_provenance: {
				transport: "cloudflare_ai_gateway_rest",
				account_id: "account-id",
				gateway: { selection: "account_default" },
				gateway_log_id: "gateway-log-one",
				requested_model: "google/gemini-3.7-flash",
				correlation: { run_id: "benchmark-one", invocation_id: "invocation-one" },
				policy: {
					cache: "bypass",
					log_metadata: true,
					log_payload: false,
					max_attempts: 1,
					request_timeout_ms: 600000,
				},
			},
		}]),
		NOW,
	).run();
	const status = await readGenerationRunStatus(env.DB, params);
	expect(status).toMatchObject({
		state: "running",
		current_step: "main_story_copyedit",
		completed_steps: ["prepare-evidence", "main_story_write"],
		model_usage: [{
			production_step: "main_story_write",
			request_provenance: {
				requested_model: "google/gemini-3.7-flash",
				policy: {
					cache: "bypass",
					log_metadata: true,
					log_payload: false,
					max_attempts: 1,
					request_timeout_ms: 600000,
				},
			},
		}],
	});
	if (status === undefined) throw new Error("Expected reopened generation run status");
	const policy = status.model_usage[0]?.request_provenance?.policy;
	if (policy === undefined) throw new Error("Expected retained Gateway provenance policy");
	expect(Object.hasOwn(policy, "request_format")).toBe(false);
	expect(Object.hasOwn(policy, "response_delivery")).toBe(false);
	expect(Object.hasOwn(policy, "structured_output")).toBe(false);
});

it("D1 rejects invalid state and malformed progress JSON", async () => {
	await expect(env.DB.prepare(
		`INSERT INTO generation_run_status (
		 active_region_id, publication_date, state, current_step, completed_steps_json,
		 model_usage_json, failure_json, created_at_utc, updated_at_utc
		) VALUES ('7', '2026-02-13', 'invalid', NULL, '[]', '[]', NULL, ?1, ?1)`,
	).bind(NOW).run()).rejects.toThrow();
	await expect(env.DB.prepare(
		`INSERT INTO generation_run_status (
		 active_region_id, publication_date, state, current_step, completed_steps_json,
		 model_usage_json, failure_json, created_at_utc, updated_at_utc
		) VALUES ('7', '2026-02-14', 'queued', NULL, 'not-json', '[]', NULL, ?1, ?1)`,
	).bind(NOW).run()).rejects.toThrow();
	await expect(env.DB.prepare(
		`INSERT INTO generation_run_status (
		 active_region_id, publication_date, state, current_step, completed_steps_json,
		 model_usage_json, diagnostics_json, failure_json, created_at_utc, updated_at_utc
		) VALUES ('7', '2026-02-17', 'queued', NULL, '[]', '[]', 'not-json', NULL, ?1, ?1)`,
	).bind(NOW).run()).rejects.toThrow();
});

it("D1 accepts only the rewritten seven-step vocabulary", async () => {
	await expect(env.DB.prepare(
		`INSERT INTO generation_run_status (
		 active_region_id, publication_date, state, current_step, completed_steps_json,
		 model_usage_json, failure_json, created_at_utc, updated_at_utc
		) VALUES ('7', '2026-02-10', 'running', 'compose-main-story', '[]', '[]', NULL, ?1, ?1)`,
	).bind(NOW).run()).rejects.toThrow();
	await expect(env.DB.prepare(
		`INSERT INTO generation_run_status (
		 active_region_id, publication_date, state, current_step, completed_steps_json,
		 model_usage_json, failure_json, created_at_utc, updated_at_utc
		) VALUES ('7', '2026-02-11', 'running', 'main_story_write', '[]', '[]', NULL, ?1, ?1)`,
	).bind(NOW).run()).resolves.toBeDefined();
});

it("queues before Workflow create and marks only a newly inserted row on rejection", async () => {
	const params = pair("2026-02-08");
	const createError = new Error("create rejected");
	const workflow = { create: vi.fn().mockRejectedValue(createError) } as unknown as Workflow<GenerationRunParams>;
	await expect(launchGenerationRun(params, workflow, env.DB)).rejects.toBe(createError);
	await expect(readGenerationRunStatus(env.DB, params)).resolves.toMatchObject({
		state: "errored",
		failure: { step: "launch-generation-run", message: "create rejected" },
	});
	const existing = pair("2026-02-09");
	await queueGenerationRunStatus(env.DB, existing, NOW);
	await recordGenerationRunProgress(env.DB, existing, {
		currentStep: "prepare-evidence",
		completedSteps: [],
		modelUsage: [],
		diagnostics: [],
	}, "2026-08-04T23:01:00.000Z");
	await expect(launchGenerationRun(existing, workflow, env.DB)).rejects.toBe(createError);
	await expect(readGenerationRunStatus(env.DB, existing)).resolves.toMatchObject({ state: "running" });
});

it("retains Workflow-create and failure-status errors in deterministic order", async () => {
	const params = pair("2026-02-15");
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
