import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import type { GenerationRunParams } from "@bc-news/contracts";
import type { ModelUsageRecord } from "@bc-news/generation-core";
import { generationRunAttemptInvocationId } from "../src/generation-run-instance-id";
import {
	CURRENT_GENERATION_RUN_CONTRACT_VERSION,
	GENERATION_STEPS,
	GenerationRunStatusUnreadableError,
	PREVIOUS_CURRENT_GENERATION_RUN_CONTRACT_VERSION,
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

function usage(
	productionStep: "main_story_write" | "announcements_write",
): ModelUsageRecord {
	return {
		production_step: productionStep,
		provider: "recorded",
		model: `recorded/${productionStep}`,
		execution: "recorded_replay",
		token_usage: { measurement: "unavailable" },
		external_billing: { classification: "none", amount_usd: 0, reason: "recorded_replay" },
	};
}

const allUsage = [
	usage("main_story_write"),
	usage("announcements_write"),
] as const;

function attempt(
	params: GenerationRunParams,
	productionStep: "main_story_write" | "announcements_write",
	attemptNumber: 1 | 2,
	outcome: { status: "accepted" } | { status: "rejected"; code: "invalid_json" | "contract_mismatch"; message: string } = { status: "accepted" },
	modelUsage: ModelUsageRecord = usage(productionStep),
) {
	return {
		production_step: productionStep,
		attempt: attemptNumber,
		invocation_id: generationRunAttemptInvocationId(params, productionStep, attemptNumber),
		outcome,
		model_usage: modelUsage,
	};
}

const legacyCompleteUsage = [
	{
		production_step: "main_story_write",
		provider: "google",
		model: "gemini-3.7-flash",
		execution: "hosted_inference",
		token_usage: { measurement: "reported", input_tokens: 100, output_tokens: 25, total_tokens: 125 },
		external_billing: { classification: "unavailable", reason: "provider_did_not_report_cost" },
	},
	{
		production_step: "main_story_copyedit",
		provider: "google",
		model: "gemini-3.7-flash",
		execution: "hosted_inference",
		token_usage: { measurement: "reported", input_tokens: 125, output_tokens: 20, total_tokens: 145 },
		external_billing: { classification: "unavailable", reason: "provider_did_not_report_cost" },
	},
	{
		production_step: "announcements_write",
		provider: "google",
		model: "gemini-3.7-flash",
		execution: "hosted_inference",
		token_usage: { measurement: "reported", input_tokens: 90, output_tokens: 30, total_tokens: 120 },
		external_billing: { classification: "unavailable", reason: "provider_did_not_report_cost" },
	},
	{
		production_step: "announcements_copyedit",
		provider: "google",
		model: "gemini-3.7-flash",
		execution: "hosted_inference",
		token_usage: { measurement: "reported", input_tokens: 120, output_tokens: 18, total_tokens: 138 },
		external_billing: { classification: "unavailable", reason: "provider_did_not_report_cost" },
	},
] as const;

const legacyCompleteDiagnostics = [
	{
		kind: "preservation",
		production_step: "main_story_copyedit",
		code: "paragraph_count",
		message: "Copyedit changed paragraph count in main_story.body",
	},
	{
		kind: "final_product",
		production_step: "announcements_copyedit",
		code: "forbidden_marker",
		message: "Copyedit emitted a forbidden marker in announcements",
	},
] as const;

function diagnostic(
	productionStep: "main_story_write" | "announcements_write" = "main_story_write",
) {
	return {
		kind: "final_product" as const,
		production_step: productionStep,
		code: "forbidden_marker" as const,
		message: `Writer emitted a forbidden marker in ${productionStep}`,
	};
}

it("queues a current-version projection and duplicate queue does not reset progress", async () => {
	const params = pair("2026-02-01");
	await expect(queueGenerationRunStatus(env.DB, params, NOW)).resolves.toBe(true);
	await recordGenerationRunProgress(env.DB, params, {
		currentStep: "main_story_write",
		completedSteps: ["prepare-evidence"],
		modelUsage: [],
		modelAttempts: [],
		diagnostics: [],
	}, "2026-08-04T23:01:00.000Z");
	await expect(queueGenerationRunStatus(env.DB, params, "2026-08-04T23:02:00.000Z")).resolves.toBe(false);
	await expect(readGenerationRunStatus(env.DB, params)).resolves.toMatchObject({
		contract_version: CURRENT_GENERATION_RUN_CONTRACT_VERSION,
		state: "running",
		current_step: "main_story_write",
		completed_steps: ["prepare-evidence"],
		model_usage: [],
		diagnostics: [],
		created_at_utc: NOW,
	});
});

it("retains completed writer usage when the next writer is current", async () => {
	const params = pair("2026-02-02");
	await queueGenerationRunStatus(env.DB, params, NOW);
	const progress = {
		currentStep: "announcements_write" as const,
		completedSteps: ["prepare-evidence", "main_story_write"] as const,
		modelUsage: [usage("main_story_write")] as const,
		modelAttempts: [
			attempt(params, "main_story_write", 1, { status: "accepted" }, usage("main_story_write")),
		] as const,
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
	}, "2026-08-04T23:03:00.000Z")).rejects.toThrow(
		"accepted attempt evidence for main_story_write must match its accepted model usage",
	);
});

it("rejects out-of-order, missing, or extra current model usage", async () => {
	const params = pair("2026-02-03");
	await queueGenerationRunStatus(env.DB, params, NOW);
	const completedSteps = [
		"prepare-evidence",
		"main_story_write",
		"announcements_write",
	] as const;
	for (const modelUsage of [
		[usage("announcements_write"), usage("main_story_write")],
		[usage("main_story_write")],
		[usage("main_story_write"), usage("announcements_write"), usage("main_story_write")],
	]) {
		await expect(recordGenerationRunProgress(env.DB, params, {
			currentStep: "validate-edition",
			completedSteps,
			modelUsage,
			modelAttempts: [
				attempt(params, "main_story_write", 1, { status: "accepted" }, usage("main_story_write")),
				attempt(params, "announcements_write", 1, { status: "accepted" }, usage("announcements_write")),
			],
			diagnostics: [],
		}, "2026-08-04T23:01:00.000Z")).rejects.toThrow();
	}
});

it("records complete only with all five steps and matching accepted attempts", async () => {
	const params = pair("2026-02-04");
	await queueGenerationRunStatus(env.DB, params, NOW);
	const modelAttempts = [
		attempt(params, "main_story_write", 1, { status: "accepted" }, allUsage[0]),
		attempt(params, "announcements_write", 1, { status: "accepted" }, allUsage[1]),
	] as const;
	await recordGenerationRunProgress(env.DB, params, {
		currentStep: "publish-edition",
		completedSteps: GENERATION_STEPS.slice(0, -1),
		modelUsage: allUsage,
		modelAttempts,
		diagnostics: [diagnostic(), diagnostic("announcements_write")],
	}, "2026-08-04T23:01:00.000Z");
	const diagnostics = [diagnostic(), diagnostic("announcements_write")];
	await recordGenerationRunComplete(
		env.DB,
		params,
		allUsage,
		modelAttempts,
		diagnostics,
		"2026-08-04T23:02:00.000Z",
	);
	await expect(readGenerationRunStatus(env.DB, params)).resolves.toMatchObject({
		contract_version: CURRENT_GENERATION_RUN_CONTRACT_VERSION,
		state: "complete",
		current_step: null,
		completed_steps: GENERATION_STEPS,
		model_usage: allUsage,
		model_attempts: modelAttempts,
		diagnostics,
	});
});

it("retains completed steps, usages, and diagnostics on later failure", async () => {
	const params = pair("2026-02-05");
	await queueGenerationRunStatus(env.DB, params, NOW);
	const diagnostics = [diagnostic(), diagnostic("announcements_write")];
	const modelAttempts = [
		attempt(params, "main_story_write", 1, { status: "accepted" }, allUsage[0]),
		attempt(params, "announcements_write", 1, { status: "accepted" }, allUsage[1]),
	] as const;
	await recordGenerationRunProgress(env.DB, params, {
		currentStep: "publish-edition",
		completedSteps: GENERATION_STEPS.slice(0, -1),
		modelUsage: allUsage,
		modelAttempts,
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
		model_attempts: modelAttempts,
		diagnostics,
		failure: { step: "publish-edition", code: "publish_failed" },
	});
});

it("rejects diagnostic regression, replacement, and out-of-order attribution", async () => {
	const params = pair("2026-02-06");
	await queueGenerationRunStatus(env.DB, params, NOW);
	const retained = diagnostic();
	const progress = {
		currentStep: "publish-edition" as const,
		completedSteps: GENERATION_STEPS.slice(0, -1),
		modelUsage: allUsage,
		modelAttempts: [
			attempt(params, "main_story_write", 1, { status: "accepted" }, allUsage[0]),
			attempt(params, "announcements_write", 1, { status: "accepted" }, allUsage[1]),
		] as const,
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
		diagnostics: [diagnostic("announcements_write"), retained],
	}, "2026-08-04T23:04:00.000Z")).rejects.toThrow("production step order");
});

it("retains a rejected first attempt while the same writer remains current and rejects mutated attempt history", async () => {
	const params = pair("2026-02-07");
	await queueGenerationRunStatus(env.DB, params, NOW);
	const rejectedAttempt = attempt(params, "main_story_write", 1, {
		status: "rejected",
		code: "invalid_json",
		message: "main_story_write model output is not valid JSON",
	});
	await recordGenerationRunProgress(env.DB, params, {
		currentStep: "main_story_write",
		completedSteps: ["prepare-evidence"],
		modelUsage: [],
		modelAttempts: [rejectedAttempt],
		diagnostics: [],
	}, "2026-08-04T23:01:00.000Z");
	await recordGenerationRunProgress(env.DB, params, {
		currentStep: "main_story_write",
		completedSteps: ["prepare-evidence"],
		modelUsage: [],
		modelAttempts: [rejectedAttempt],
		diagnostics: [],
	}, "2026-08-04T23:02:00.000Z");
	await expect(readGenerationRunStatus(env.DB, params)).resolves.toMatchObject({
		state: "running",
		current_step: "main_story_write",
		model_usage: [],
		model_attempts: [rejectedAttempt],
	});
	await expect(recordGenerationRunProgress(env.DB, params, {
		currentStep: "main_story_write",
		completedSteps: ["prepare-evidence"],
		modelUsage: [],
		modelAttempts: [{
			...rejectedAttempt,
			outcome: { status: "rejected", code: "invalid_json", message: "replacement" },
		}],
		diagnostics: [],
	}, "2026-08-04T23:03:00.000Z")).rejects.toThrow("model attempts cannot regress or replace");
});

it("reads a current_v1 row without upgrading it into v2 attempt retention", async () => {
	const params = pair("2026-02-14");
	await env.DB.prepare(
		`INSERT INTO generation_run_status (
		 contract_version, active_region_id, publication_date, state, current_step, completed_steps_json,
		 model_usage_json, diagnostics_json, failure_json, created_at_utc, updated_at_utc
		) VALUES (?1, ?2, ?3, 'running', 'announcements_write', ?4, ?5, '[]', NULL, ?6, ?6)`,
	).bind(
		PREVIOUS_CURRENT_GENERATION_RUN_CONTRACT_VERSION,
		params.active_region_id,
		params.publication_date,
		JSON.stringify(["prepare-evidence", "main_story_write"]),
		JSON.stringify([usage("main_story_write")]),
		NOW,
	).run();
	const status = await readGenerationRunStatus(env.DB, params);
	expect(status).toMatchObject({
		contract_version: PREVIOUS_CURRENT_GENERATION_RUN_CONTRACT_VERSION,
		current_step: "announcements_write",
		model_usage: [usage("main_story_write")],
	});
	if (status === undefined) throw new Error("Expected current_v1 generation run status");
	expect(Object.hasOwn(status, "model_attempts")).toBe(false);
});

it("surfaces corrupt stored JSON as unreadable status", async () => {
	await env.DB.prepare(
		`INSERT INTO generation_run_status (
		 contract_version, active_region_id, publication_date, state, current_step, completed_steps_json,
		 model_usage_json, diagnostics_json, failure_json, created_at_utc, updated_at_utc
		) VALUES (?1, '7', '2026-02-15', 'queued', NULL, ?2, '[]', '[]', NULL, ?3, ?3)`,
	).bind(CURRENT_GENERATION_RUN_CONTRACT_VERSION, JSON.stringify({ invalid: true }), NOW).run();
	await expect(readGenerationRunStatus(env.DB, pair("2026-02-15"))).rejects.toBeInstanceOf(
		GenerationRunStatusUnreadableError,
	);
});

it("routes untagged rows only through the complete legacy parser", async () => {
	const params = pair("2026-02-08");
	await env.DB.prepare(
		`INSERT INTO generation_run_status (
		 active_region_id, publication_date, state, current_step, completed_steps_json,
		 model_usage_json, diagnostics_json, failure_json, created_at_utc, updated_at_utc
		) VALUES ('7', '2026-02-08', 'running', 'main_story_copyedit', ?1, ?2, '[]', NULL, ?3, ?3)`,
	).bind(
		JSON.stringify(["prepare-evidence", "main_story_write"]),
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
	});
	if (status === undefined) throw new Error("Expected reopened generation run status");
	expect(Object.hasOwn(status, "contract_version")).toBe(false);
});

it("reads a complete seven-step untagged legacy row with preserved copyedit diagnostics", async () => {
	const params = pair("2026-02-13");
	await env.DB.prepare(
		`INSERT INTO generation_run_status (
		 active_region_id, publication_date, state, current_step, completed_steps_json,
		 model_usage_json, diagnostics_json, failure_json, created_at_utc, updated_at_utc
		) VALUES ('7', ?1, 'complete', NULL, ?2, ?3, ?4, NULL, ?5, ?5)`,
	).bind(
		params.publication_date,
		JSON.stringify([
			"prepare-evidence",
			"main_story_write",
			"main_story_copyedit",
			"announcements_write",
			"announcements_copyedit",
			"validate-edition",
			"publish-edition",
		]),
		JSON.stringify(legacyCompleteUsage),
		JSON.stringify(legacyCompleteDiagnostics),
		NOW,
	).run();
	const status = await readGenerationRunStatus(env.DB, params);
	expect(status).toMatchObject({
		state: "complete",
		current_step: null,
		completed_steps: [
			"prepare-evidence",
			"main_story_write",
			"main_story_copyedit",
			"announcements_write",
			"announcements_copyedit",
			"validate-edition",
			"publish-edition",
		],
		model_usage: legacyCompleteUsage,
		diagnostics: legacyCompleteDiagnostics,
	});
	if (status === undefined) throw new Error("Expected complete legacy generation run status");
	expect(status.model_usage).toHaveLength(4);
	expect(status.diagnostics).toHaveLength(2);
	expect(Object.hasOwn(status, "contract_version")).toBe(false);
});

it("D1 accepts the new five-step subset and rejects invented steps", async () => {
	await expect(env.DB.prepare(
		`INSERT INTO generation_run_status (
		 active_region_id, publication_date, state, current_step, completed_steps_json,
		 model_usage_json, diagnostics_json, failure_json, created_at_utc, updated_at_utc
		) VALUES ('7', '2026-02-09', 'running', 'compose-main-story', '[]', '[]', '[]', NULL, ?1, ?1)`,
	).bind(NOW).run()).rejects.toThrow();
	await expect(env.DB.prepare(
		`INSERT INTO generation_run_status (
		 contract_version, active_region_id, publication_date, state, current_step, completed_steps_json,
		 model_usage_json, diagnostics_json, failure_json, created_at_utc, updated_at_utc
		) VALUES (?1, '7', '2026-02-10', 'running', 'main_story_write', '[]', '[]', '[]', NULL, ?2, ?2)`,
	).bind(CURRENT_GENERATION_RUN_CONTRACT_VERSION, NOW).run()).resolves.toBeDefined();
});

it("queues before Workflow create and marks only a newly inserted row on rejection", async () => {
	const params = pair("2026-02-11");
	const createError = new Error("create rejected");
	const workflow = { create: vi.fn().mockRejectedValue(createError) } as unknown as Workflow<GenerationRunParams>;
	await expect(launchGenerationRun(params, workflow, env.DB)).rejects.toBe(createError);
	await expect(readGenerationRunStatus(env.DB, params)).resolves.toMatchObject({
		contract_version: CURRENT_GENERATION_RUN_CONTRACT_VERSION,
		state: "errored",
		failure: { step: "launch-generation-run", message: "create rejected" },
	});

	const existing = pair("2026-02-12");
	await queueGenerationRunStatus(env.DB, existing, NOW);
	await recordGenerationRunProgress(env.DB, existing, {
		currentStep: "prepare-evidence",
		completedSteps: [],
		modelUsage: [],
		modelAttempts: [],
		diagnostics: [],
	}, "2026-08-04T23:01:00.000Z");
	await expect(launchGenerationRun(existing, workflow, env.DB)).rejects.toBe(createError);
	await expect(readGenerationRunStatus(env.DB, existing)).resolves.toMatchObject({ state: "running" });
});
