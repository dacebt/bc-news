import { expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { ACTIVE_REGION_IDS, type GenerationRunParams } from "@bc-news/contracts";
import { launchGenerationRun, type GenerationRunLaunch } from "../src/run-launch";
import { publicationDateForScheduledTime, scheduleGenerationRuns } from "../src/scheduler";

function workflowWith(
	create: ReturnType<typeof vi.fn>,
	get: ReturnType<typeof vi.fn> = vi.fn().mockRejectedValue(new Error("not found")),
): Workflow<GenerationRunParams> {
	return { create, get } as unknown as Workflow<GenerationRunParams>;
}

function created(params: GenerationRunParams): GenerationRunLaunch {
	return {
		outcome: "created",
		id: `generation-run-${params.active_region_id}-${params.publication_date}`,
		params,
	};
}

it("derives the strict UTC publication date on both sides of midnight", () => {
	expect(publicationDateForScheduledTime(Date.parse("2026-01-24T23:59:59.999Z"))).toBe("2026-01-24");
	expect(publicationDateForScheduledTime(Date.parse("2026-01-25T00:00:00.000Z"))).toBe("2026-01-25");
});

it("rejects a scheduled time that cannot derive a publication date", () => {
	expect(() => publicationDateForScheduledTime(Number.NaN)).toThrow(
		"did not derive a valid UTC publication date",
	);
});

it("launches the authoritative active-region roster exactly once", async () => {
	const launchedParams: GenerationRunParams[] = [];
	const launcher = vi.fn().mockImplementation((params: GenerationRunParams) => {
		launchedParams.push(params);
		return Promise.resolve(created(params));
	});
	const workflow = workflowWith(vi.fn());

	const results = await scheduleGenerationRuns(
		Date.parse("2026-01-25T00:00:00Z"),
		{ GENERATION_RUN: workflow, DB: env.DB },
		launcher,
	);

	expect(launcher).toHaveBeenCalledTimes(ACTIVE_REGION_IDS.length);
	expect(launchedParams.map((params) => params.active_region_id)).toEqual(ACTIVE_REGION_IDS);
	expect(results).toHaveLength(ACTIVE_REGION_IDS.length);
});

it("attempts later regions after one launch fails", async () => {
	const launcher = vi.fn().mockImplementation((params: GenerationRunParams) => {
		if (params.active_region_id === "7") {
			return Promise.reject(new Error("region 7 create failed"));
		}
		return Promise.resolve(created(params));
	});

	await expect(
		scheduleGenerationRuns(
			Date.parse("2026-01-25T00:00:00Z"),
			{ GENERATION_RUN: workflowWith(vi.fn()), DB: env.DB },
			launcher,
		),
	).rejects.toThrow("7/2026-01-25");
	expect(launcher).toHaveBeenCalledTimes(ACTIVE_REGION_IDS.length);
});

it("aggregates every unexpected regional launch failure", async () => {
	const launcher = vi.fn().mockImplementation((params: GenerationRunParams) => {
		if (params.active_region_id === "7" || params.active_region_id === "19") {
			return Promise.reject(new Error(`create failed ${params.active_region_id}`));
		}
		return Promise.resolve(created(params));
	});

	let thrown: unknown;
	try {
		await scheduleGenerationRuns(
			Date.parse("2026-01-25T00:00:00Z"),
			{ GENERATION_RUN: workflowWith(vi.fn()), DB: env.DB },
			launcher,
		);
	} catch (error) {
		thrown = error;
	}
	expect(thrown).toBeInstanceOf(AggregateError);
	expect((thrown as AggregateError).message).toContain("7/2026-01-25");
	expect((thrown as AggregateError).message).toContain("19/2026-01-25");
	expect((thrown as AggregateError).errors).toHaveLength(2);
});

it("returns created when local Wrangler silently resolves a same-id create", async () => {
	const params = { active_region_id: "7", publication_date: "2026-01-25" } as const;
	const workflow = workflowWith(
		vi.fn().mockResolvedValue({ id: "generation-run-7-2026-01-25" }),
		vi.fn().mockResolvedValue({ id: "generation-run-7-2026-01-25" }),
	);

	await expect(launchGenerationRun(params, workflow, env.DB)).resolves.toMatchObject({
		outcome: "created",
		id: "generation-run-7-2026-01-25",
	});
});
