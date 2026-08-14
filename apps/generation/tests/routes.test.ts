import { expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import type { GenerationRunParams } from "@bc-news/contracts";
import { queueGenerationRunStatus } from "../src/generation-run-status";
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

const COMPLETE_MODEL_USAGE = [
	"main_story_write",
	"main_story_copyedit",
	"announcements_write",
	"announcements_copyedit",
].map((production_step) => ({
	production_step,
	provider: "r",
	model: "m",
	execution: "recorded_replay",
	token_usage: { measurement: "unavailable" },
	external_billing: { classification: "none", amount_usd: 0, reason: "recorded_replay" },
}));

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

it("surfaces an unrelated create rejection even when the same id can be read", async () => {
	const createError = new Error("workflow service unavailable");
	const get = vi.fn().mockResolvedValue({ id: "generation-run-7-2026-01-25" });

	await expect(
		createGenerationRun(request(), envWith(vi.fn().mockRejectedValue(createError), get)),
	).rejects.toBe(createError);
	expect(get).not.toHaveBeenCalled();
});

it("surfaces a create rejection without probing get when the id lookup would fail", async () => {
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
			"main_story_copyedit",
			"announcements_write",
			"announcements_copyedit",
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
] as const)("composes strict %s projection with a separate Workflow observation", async (state, currentStep, completed, usage, failure) => {
	const publicationDate = `2026-03-0${String({ queued: 2, running: 3, complete: 4, errored: 5 }[state])}`;
	await env.DB.prepare(
		`INSERT INTO generation_run_status (
		 active_region_id, publication_date, state, current_step, completed_steps_json,
		 model_usage_json, failure_json, created_at_utc, updated_at_utc
		) VALUES ('7', ?1, ?2, ?3, ?4, ?5, ?6, '2026-08-04T23:00:00.000Z', '2026-08-04T23:00:00.000Z')`,
	).bind(publicationDate, state, currentStep, completed, usage, failure).run();
	const get = vi.fn().mockResolvedValue({
		status: vi.fn().mockResolvedValue({ status: state === "errored" ? "errored" : state }),
	});
	const response = await getGenerationRunStatusByPair(
		pairRequest(publicationDate),
		envWith(vi.fn(), get),
	);
	expect(response.status).toBe(200);
	expect(await response.json()).toMatchObject({
		active_region_id: "7",
		publication_date: publicationDate,
		generation_run_id: `generation-run-7-${publicationDate}`,
		state,
		workflow: { observation: "available", status: state },
	});
});

it("returns unreadable projection as 500 and keeps failed Workflow observation explicit", async () => {
	await env.DB.prepare(
		`INSERT INTO generation_run_status (
		 active_region_id, publication_date, state, current_step, completed_steps_json,
		 model_usage_json, failure_json, created_at_utc, updated_at_utc
		) VALUES ('7', '2026-03-06', 'queued', NULL, '["publish-edition"]', '[]', NULL,
		 '2026-08-04T23:00:00.000Z', '2026-08-04T23:00:00.000Z')`,
	).run();
	const unreadable = await getGenerationRunStatusByPair(
		pairRequest("2026-03-06"),
		envWith(vi.fn()),
	);
	expect(unreadable.status).toBe(500);

	const params = { active_region_id: "7", publication_date: "2026-03-07" } as const;
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

it("exposes retained editorial diagnostics through the strict operator status route", async () => {
	const publicationDate = "2026-03-12";
	const completedSteps = ["prepare-evidence", "main_story_write", "main_story_copyedit"];
	const diagnostics = [{
		kind: "preservation",
		production_step: "main_story_copyedit",
		code: "paragraph_count",
		message: "Copyedit changed paragraph count in main_story.body",
	}];
	await env.DB.prepare(
		`INSERT INTO generation_run_status (
		 active_region_id, publication_date, state, current_step, completed_steps_json,
		 model_usage_json, diagnostics_json, failure_json, created_at_utc, updated_at_utc
		) VALUES ('7', ?1, 'running', 'announcements_write', ?2, ?3, ?4, NULL,
		 '2026-08-04T23:00:00.000Z', '2026-08-04T23:00:00.000Z')`,
	).bind(
		publicationDate,
		JSON.stringify(completedSteps),
		JSON.stringify(COMPLETE_MODEL_USAGE.slice(0, 2)),
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
	const params = { active_region_id: "7", publication_date: "2026-03-08" } as const;
	await queueGenerationRunStatus(env.DB, params, "2026-08-04T23:00:00.000Z");
	const get = vi.fn().mockResolvedValue({ status: vi.fn().mockResolvedValue({ status: "invented" }) });
	await expect(
		getGenerationRunStatusByPair(pairRequest(params.publication_date), envWith(vi.fn(), get)),
	).rejects.toThrow();
});

it("accepts legitimate optional Workflow output and local-dev step outputs", async () => {
	const params = { active_region_id: "7", publication_date: "2026-03-09" } as const;
	await queueGenerationRunStatus(env.DB, params, "2026-08-04T23:00:00.000Z");
	const get = vi.fn().mockResolvedValue({
		status: vi.fn().mockResolvedValue({
			status: "queued",
			output: { retained: "platform" },
			__LOCAL_DEV_STEP_OUTPUTS: [{ local: "step" }, null, 3],
		}),
	});
	const response = await getGenerationRunStatusByPair(
		pairRequest(params.publication_date),
		envWith(vi.fn(), get),
	);
	expect(response.status).toBe(200);
	const body = await response.json();
	if (typeof body !== "object" || body === null || !("workflow" in body)) {
		throw new Error("Expected operator status response with workflow");
	}
	expect(body.workflow).toEqual({ observation: "available", status: "queued", error: null });
});

it("rejects malformed non-array local-dev step outputs", async () => {
	const params = { active_region_id: "7", publication_date: "2026-03-11" } as const;
	await queueGenerationRunStatus(env.DB, params, "2026-08-04T23:00:00.000Z");
	const get = vi.fn().mockResolvedValue({
		status: vi.fn().mockResolvedValue({
			status: "queued",
			__LOCAL_DEV_STEP_OUTPUTS: { local: "not-an-array" },
		}),
	});
	await expect(
		getGenerationRunStatusByPair(pairRequest(params.publication_date), envWith(vi.fn(), get)),
	).rejects.toThrow();
});

it("rejects unexpected Workflow status keys", async () => {
	const params = { active_region_id: "7", publication_date: "2026-03-10" } as const;
	await queueGenerationRunStatus(env.DB, params, "2026-08-04T23:00:00.000Z");
	const get = vi.fn().mockResolvedValue({
		status: vi.fn().mockResolvedValue({ status: "queued", invented: true }),
	});
	await expect(
		getGenerationRunStatusByPair(pairRequest(params.publication_date), envWith(vi.fn(), get)),
	).rejects.toThrow();
});
