import { introspectWorkflowInstance } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";
import { GenerationRunParamsSchema } from "@bc-news/contracts";
import { recordedModelProvider } from "@bc-news/fixtures";
import { readEdition } from "../src/edition-store";
import { queueGenerationRunStatus, readGenerationRunStatus } from "../src/generation-run-status";

afterEach(() => {
	vi.restoreAllMocks();
});

// This run's subject is durable retry (the model call is not repeated), not
// evidence sourcing. The Workflow's bound env is fixed by the compiled
// worker config -- EVIDENCE_INPUT=d1_chat, the committed default -- and the
// vitest pool worker gives no per-instance way to swap that binding, so the
// window is seeded directly rather than reaching for the fixture adapter.
async function seedChatMessage(): Promise<void> {
	await env.DB.prepare(
		`INSERT INTO chat_messages (
			entity_id, region_id, channel_id, username_raw, username, text, timestamp_utc, timestamp_ts
		) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
	)
		.bind(
			"generation-run-test-msg-1",
			7,
			1,
			"en/Someone",
			"Someone",
			"a message worth reporting",
			"2026-01-24T12:00:00Z",
			Date.UTC(2026, 0, 24, 12, 0, 0, 0),
		)
		.run();
}

it("rejects a leading-zero region identity alias", () => {
	const publicationDate = "2026-01-25";

	expect(
		GenerationRunParamsSchema.safeParse({
			active_region_id: "07",
			publication_date: publicationDate,
		}).success,
	).toBe(false);
	expect(
		GenerationRunParamsSchema.safeParse({
			active_region_id: "7",
			publication_date: publicationDate,
		}).success,
	).toBe(true);
});

it("interrupted run does not repeat the model call", async () => {
	await seedChatMessage();
	await queueGenerationRunStatus(
		env.DB,
		{ active_region_id: "7", publication_date: "2026-01-25" },
		"2026-08-04T23:00:00.000Z",
	);
	const modelCalls = vi.spyOn(recordedModelProvider, "complete");
	await using instance = await introspectWorkflowInstance(
		env.GENERATION_RUN,
		"generation-run-7-2026-01-25",
	);
	await instance.modify(async (m) => {
		await m.disableRetryDelays();
		await m.mockStepError({ name: "publish-edition" }, new Error("transient publish failure"), 1);
	});

	await env.GENERATION_RUN.create({
		id: "generation-run-7-2026-01-25",
		params: { active_region_id: "7", publication_date: "2026-01-25" },
	});
	await instance.waitForStatus("complete");

	// One call each for compose-main-story, compose-announcements, and
	// compose-packaging: all three complete and cache before publish-edition's
	// mocked failure forces a step retry, so the retry repeats only the failed
	// step, not the model calls that already succeeded.
	expect(modelCalls).toHaveBeenCalledTimes(3);
	const served = await readEdition(env.DB, "7", "2026-01-25");
	expect(served?.active_region_id).toBe("7");
	await expect(
		readGenerationRunStatus(env.DB, { active_region_id: "7", publication_date: "2026-01-25" }),
	).resolves.toMatchObject({
		state: "complete",
		completed_steps: [
			"prepare-evidence",
			"compose-main-story",
			"compose-announcements",
			"compose-packaging",
			"validate-edition",
			"publish-edition",
		],
		model_usage: [
			{ editorial_capability: "main_story" },
			{ editorial_capability: "announcements" },
			{ editorial_capability: "packaging" },
		],
	});
});

it("a retried status write does not repeat the completed main-story model call", async () => {
	const params = { active_region_id: "7", publication_date: "2026-01-26" } as const;
	await env.DB.prepare(
		`INSERT INTO chat_messages (
		 entity_id, region_id, channel_id, username_raw, username, text, timestamp_utc, timestamp_ts
		) VALUES ('generation-run-test-msg-2', 7, 1, 'en/Someone', 'Someone',
		 'another message worth reporting', '2026-01-25T12:00:00Z', ?1)`,
	).bind(Date.UTC(2026, 0, 25, 12)).run();
	await queueGenerationRunStatus(env.DB, params, "2026-08-04T23:00:00.000Z");
	const modelCalls = vi.spyOn(recordedModelProvider, "complete");
	await using instance = await introspectWorkflowInstance(env.GENERATION_RUN, "generation-run-7-2026-01-26");
	await instance.modify(async (m) => {
		await m.disableRetryDelays();
		await m.mockStepError({ name: "record-main-story-status" }, new Error("transient status failure"), 1);
	});
	await env.GENERATION_RUN.create({ id: "generation-run-7-2026-01-26", params });
	await instance.waitForStatus("complete");
	expect(modelCalls).toHaveBeenCalledTimes(3);
	await expect(readGenerationRunStatus(env.DB, params)).resolves.toMatchObject({
		state: "complete",
		model_usage: [
			{ editorial_capability: "main_story" },
			{ editorial_capability: "announcements" },
			{ editorial_capability: "packaging" },
		],
	});
});

it("no evidence records prepare failure without model usage", async () => {
	const params = { active_region_id: "8", publication_date: "2026-01-25" } as const;
	await queueGenerationRunStatus(env.DB, params, "2026-08-04T23:00:00.000Z");
	await using instance = await introspectWorkflowInstance(env.GENERATION_RUN, "generation-run-8-2026-01-25");
	await instance.modify(async (m) => {
		await m.disableRetryDelays();
	});
	await env.GENERATION_RUN.create({ id: "generation-run-8-2026-01-25", params });
	await instance.waitForStatus("errored");
	await expect(readGenerationRunStatus(env.DB, params)).resolves.toMatchObject({
		state: "errored",
		completed_steps: [],
		model_usage: [],
		failure: { step: "prepare-evidence", code: "no_evidence_for_publication_date" },
	});
});
