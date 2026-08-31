import { expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import type { GenerationRunParams } from "@bc-news/contracts";
import { generationRunAttemptInvocationId } from "../src/generation-run-instance-id";
import {
	CURRENT_GENERATION_RUN_CONTRACT_VERSION,
	queueGenerationRunStatus,
} from "../src/generation-run-status";
import { createGenerationRun, getGenerationRunStatusByPair } from "../src/routes";

function request(): Request {
	return new Request("http://worker.local/generation-run", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ active_region_id: "7", publication_date: "2026-01-25" }),
	});
}

function envWith(
	create: ReturnType<typeof vi.fn>,
	get: ReturnType<typeof vi.fn> = vi.fn().mockRejectedValue(new Error("not found")),
): Env {
	return {
		DB: env.DB,
		GENERATION_RUN: { create, get } as unknown as Workflow<GenerationRunParams>,
	} as Env;
}

function pairRequest(publicationDate: string): URL {
	return new URL(
		`http://worker.local/generation-run?active_region_id=7&publication_date=${publicationDate}`,
	);
}

function pair(publicationDate: string): GenerationRunParams {
	return { active_region_id: "7", publication_date: publicationDate };
}

const COMPLETE_MODEL_USAGE = [
	"main_story_write",
	"announcements_write",
].map((production_step) => ({
	production_step,
	provider: "r",
	model: "m",
	execution: "recorded_replay",
	token_usage: { measurement: "unavailable" },
	external_billing: { classification: "none", amount_usd: 0, reason: "recorded_replay" },
}));

function acceptedAttempts(params: GenerationRunParams): string {
	return JSON.stringify((["main_story_write", "announcements_write"] as const).map((productionStep, index) => ({
		production_step: productionStep,
		attempt: 1,
		invocation_id: generationRunAttemptInvocationId(
			params,
			productionStep,
			1,
		),
		outcome: { status: "accepted" },
		model_usage: COMPLETE_MODEL_USAGE[index],
	})));
}

const LEGACY_COMPLETE_MODEL_USAGE = [
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

const LEGACY_COMPLETE_DIAGNOSTICS = [
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

it("manual generation launch returns 202 for a new deterministic instance", async () => {
	const response = await createGenerationRun(
		request(),
		envWith(vi.fn().mockResolvedValue({ id: "generation-run-7-2026-01-25" })),
	);

	expect(response.status).toBe(202);
	expect(await response.json()).toEqual({
		id: "generation-run-7-2026-01-25",
		active_region_id: "7",
		publication_date: "2026-01-25",
	});
});

it("surfaces a create rejection without probing Workflow get", async () => {
	const createError = new Error("workflow create rejected");
	const get = vi.fn().mockRejectedValue(new Error("not found"));

	await expect(
		createGenerationRun(request(), envWith(vi.fn().mockRejectedValue(createError), get)),
	).rejects.toBe(createError);
	expect(get).not.toHaveBeenCalled();
});

it("rejects an invalid status pair and reports a missing pair", async () => {
	const invalid = await getGenerationRunStatusByPair(
		new URL("http://worker.local/generation-run?active_region_id=07&publication_date=2026-01-25"),
		envWith(vi.fn()),
	);
	expect(invalid.status).toBe(400);

	const missing = await getGenerationRunStatusByPair(
		pairRequest("2026-03-01"),
		envWith(vi.fn()),
	);
	expect(missing.status).toBe(404);
	expect(await missing.json()).toMatchObject({ error: "generation_run_not_found" });
});

it.each([
	["queued", null, "[]", "[]", null],
	["running", "prepare-evidence", "[]", "[]", null],
	[
		"complete",
		null,
		JSON.stringify([
			"prepare-evidence",
			"main_story_write",
			"announcements_write",
			"validate-edition",
			"publish-edition",
		]),
		JSON.stringify(COMPLETE_MODEL_USAGE),
		null,
	],
	[
		"errored",
		null,
		"[]",
		"[]",
		JSON.stringify({ step: "prepare-evidence", code: "no_evidence_for_publication_date", message: "absent" }),
	],
] as const)("composes strict current %s projection with a separate Workflow observation", async (state, currentStep, completed, usage, failure) => {
	const publicationDate = `2026-03-0${String({ queued: 2, running: 3, complete: 4, errored: 5 }[state])}`;
	const params = pair(publicationDate);
	await env.DB.prepare(
		`INSERT INTO generation_run_status (
		 contract_version, active_region_id, publication_date, state, current_step, completed_steps_json,
		 model_usage_json, model_attempts_json, diagnostics_json, failure_json, created_at_utc, updated_at_utc
		) VALUES (?1, '7', ?2, ?3, ?4, ?5, ?6, ?7, '[]', ?8, '2026-08-04T23:00:00.000Z', '2026-08-04T23:00:00.000Z')`,
	).bind(
		CURRENT_GENERATION_RUN_CONTRACT_VERSION,
		publicationDate,
		state,
		currentStep,
		completed,
		usage,
		state === "complete" ? acceptedAttempts(params) : "[]",
		failure,
	).run();
	const get = vi.fn().mockResolvedValue({
		status: vi.fn().mockResolvedValue({ status: state === "errored" ? "errored" : state }),
	});
	const response = await getGenerationRunStatusByPair(
		pairRequest(publicationDate),
		envWith(vi.fn(), get),
	);
	expect(response.status).toBe(200);
	expect(await response.json()).toMatchObject({
		contract_version: CURRENT_GENERATION_RUN_CONTRACT_VERSION,
		active_region_id: "7",
		publication_date: publicationDate,
		generation_run_id: `generation-run-7-${publicationDate}`,
		state,
		workflow: { observation: "available", status: state },
	});
});

it("returns a legacy untagged status row through the legacy route schema", async () => {
	const publicationDate = "2026-03-06";
	await env.DB.prepare(
		`INSERT INTO generation_run_status (
		 active_region_id, publication_date, state, current_step, completed_steps_json,
		 model_usage_json, diagnostics_json, failure_json, created_at_utc, updated_at_utc
		) VALUES ('7', ?1, 'running', 'main_story_copyedit', ?2, ?3, '[]', NULL,
		 '2026-08-04T23:00:00.000Z', '2026-08-04T23:00:00.000Z')`,
	).bind(
		publicationDate,
		JSON.stringify(["prepare-evidence", "main_story_write"]),
		JSON.stringify([COMPLETE_MODEL_USAGE[0]]),
	).run();
	const response = await getGenerationRunStatusByPair(
		pairRequest(publicationDate),
		envWith(vi.fn(), vi.fn().mockResolvedValue({
			status: vi.fn().mockResolvedValue({ status: "running" }),
		})),
	);
	expect(response.status).toBe(200);
	const body = await response.json();
	expect(body).toMatchObject({
		current_step: "main_story_copyedit",
		workflow: { observation: "available", status: "running" },
	});
	expect(Object.hasOwn(body as object, "contract_version")).toBe(false);
});

it("returns a complete seven-step legacy status row with preserved copyedit diagnostics", async () => {
	const publicationDate = "2026-03-11";
	await env.DB.prepare(
		`INSERT INTO generation_run_status (
		 active_region_id, publication_date, state, current_step, completed_steps_json,
		 model_usage_json, diagnostics_json, failure_json, created_at_utc, updated_at_utc
		) VALUES ('7', ?1, 'complete', NULL, ?2, ?3, ?4, NULL,
		 '2026-08-04T23:00:00.000Z', '2026-08-04T23:00:00.000Z')`,
	).bind(
		publicationDate,
		JSON.stringify([
			"prepare-evidence",
			"main_story_write",
			"main_story_copyedit",
			"announcements_write",
			"announcements_copyedit",
			"validate-edition",
			"publish-edition",
		]),
		JSON.stringify(LEGACY_COMPLETE_MODEL_USAGE),
		JSON.stringify(LEGACY_COMPLETE_DIAGNOSTICS),
	).run();
	const response = await getGenerationRunStatusByPair(
		pairRequest(publicationDate),
		envWith(vi.fn(), vi.fn().mockResolvedValue({
			status: vi.fn().mockResolvedValue({ status: "complete" }),
		})),
	);
	expect(response.status).toBe(200);
	const body = await response.json();
	expect(body).toMatchObject({
		state: "complete",
		current_step: null,
		diagnostics: LEGACY_COMPLETE_DIAGNOSTICS,
		workflow: { observation: "available", status: "complete" },
	});
	if (!Array.isArray((body as { model_usage?: unknown }).model_usage)) {
		throw new Error("Expected legacy route response to include model usage");
	}
	expect((body as { model_usage: unknown[] }).model_usage).toHaveLength(4);
	expect(Object.hasOwn(body as object, "contract_version")).toBe(false);
});

it("returns unreadable projection as 500 and keeps failed Workflow observation explicit", async () => {
	await env.DB.prepare(
		`INSERT INTO generation_run_status (
		 contract_version, active_region_id, publication_date, state, current_step, completed_steps_json,
		 model_usage_json, diagnostics_json, failure_json, created_at_utc, updated_at_utc
		) VALUES (?1, '7', '2026-03-07', 'queued', NULL, '["publish-edition"]', '[]', '[]', NULL,
		 '2026-08-04T23:00:00.000Z', '2026-08-04T23:00:00.000Z')`,
	).bind(CURRENT_GENERATION_RUN_CONTRACT_VERSION).run();
	const unreadable = await getGenerationRunStatusByPair(
		pairRequest("2026-03-07"),
		envWith(vi.fn()),
	);
	expect(unreadable.status).toBe(500);

	const params = { active_region_id: "7", publication_date: "2026-03-08" } as const;
	await queueGenerationRunStatus(env.DB, params, "2026-08-04T23:00:00.000Z");
	const response = await getGenerationRunStatusByPair(
		pairRequest(params.publication_date),
		envWith(vi.fn(), vi.fn().mockRejectedValue(new Error("workflow unavailable"))),
	);
	expect(response.status).toBe(200);
	expect(await response.json()).toMatchObject({
		workflow: {
			observation: "unavailable",
			error: {
				name: "WorkflowObservationUnavailable",
				message: "Workflow status is unavailable",
			},
		},
	});
});

it("exposes retained writer diagnostics through the strict operator status route", async () => {
	const publicationDate = "2026-03-09";
	const params = pair(publicationDate);
	const diagnostics = [{
		kind: "final_product",
		production_step: "main_story_write",
		code: "forbidden_marker",
		message: "Writer emitted a forbidden marker",
	}];
	await env.DB.prepare(
		`INSERT INTO generation_run_status (
		 contract_version, active_region_id, publication_date, state, current_step, completed_steps_json,
		 model_usage_json, model_attempts_json, diagnostics_json, failure_json, created_at_utc, updated_at_utc
		) VALUES (?1, '7', ?2, 'running', 'validate-edition', ?3, ?4, ?5, ?6, NULL,
		 '2026-08-04T23:00:00.000Z', '2026-08-04T23:00:00.000Z')`,
	).bind(
		CURRENT_GENERATION_RUN_CONTRACT_VERSION,
		publicationDate,
		JSON.stringify(["prepare-evidence", "main_story_write", "announcements_write"]),
		JSON.stringify(COMPLETE_MODEL_USAGE),
		acceptedAttempts(params),
		JSON.stringify(diagnostics),
	).run();
	const get = vi.fn().mockResolvedValue({
		status: vi.fn().mockResolvedValue({ status: "running" }),
	});
	const response = await getGenerationRunStatusByPair(
		pairRequest(publicationDate),
		envWith(vi.fn(), get),
	);

	expect(response.status).toBe(200);
	expect(await response.json()).toMatchObject({ diagnostics });
});

it("rejects malformed Workflow status instead of leaking it", async () => {
	const params = { active_region_id: "7", publication_date: "2026-03-10" } as const;
	await queueGenerationRunStatus(env.DB, params, "2026-08-04T23:00:00.000Z");
	const get = vi.fn().mockResolvedValue({ status: vi.fn().mockResolvedValue({ status: "invented" }) });
	await expect(
		getGenerationRunStatusByPair(pairRequest(params.publication_date), envWith(vi.fn(), get)),
	).rejects.toThrow();
});
