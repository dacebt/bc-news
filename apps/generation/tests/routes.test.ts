import { expect, it, vi } from "vitest";
import type { GenerationRunParams } from "@bc-news/contracts";
import { createGenerationRun } from "../src/routes";

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
		GENERATION_RUN: { create, get } as unknown as Workflow<GenerationRunParams>,
	} as Env;
}

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
