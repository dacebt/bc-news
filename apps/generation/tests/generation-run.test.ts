import { introspectWorkflowInstance } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";
import { GenerationRunParamsSchema } from "@bc-news/contracts";
import { recordedModelProvider } from "@bc-news/fixtures";
import type { ModelCompletion, ProductionModelStep } from "@bc-news/generation-core";
import { readEdition } from "../src/edition-store";
import { queueGenerationRunStatus, readGenerationRunStatus } from "../src/generation-run-status";

afterEach(() => {
	vi.restoreAllMocks();
});

const TEST_COMPLETION_PROVIDER = "test_double";
const TEST_COMPLETION_MODEL = "deterministic/editorial-workflow-v1";

function mockDeterministicModelCompletions(
	mutateOutputs?: (outputs: Record<ProductionModelStep, string>) => void,
) {
	const outputs: Record<ProductionModelStep, string> = {
		main_story_write: JSON.stringify({
			title: "The Daily Dispatch",
			subtitle: "A deterministic workflow test",
			main_story: {
				headline: "The Region Has News",
				lede: "A local event gave the region something worth reporting.",
				body: "Someone shared a message worth reporting with the region.",
			},
		}),
		main_story_copyedit: JSON.stringify({
			title: "The Daily Dispatch",
			subtitle: "A deterministic workflow test",
			main_story: {
				headline: "The Region Has News",
				lede: "A local event gave the region something worth reporting.",
				body: "Someone shared a message worth reporting with the region.",
			},
		}),
		announcements_write: JSON.stringify({
			announcements: [
				{
					title: "Regional Notice",
					summary: "Someone shared a message worth reporting with the region.",
				},
			],
		}),
		announcements_copyedit: JSON.stringify({
			announcements: [
				{
					id: "announcement-1",
					title: "Regional Notice",
					summary: "Someone shared a message worth reporting with the region.",
				},
			],
		}),
	};
	mutateOutputs?.(outputs);

	return vi.spyOn(recordedModelProvider, "complete").mockImplementation((request) => {
		const completion: ModelCompletion = {
			text: outputs[request.productionStep],
			provider: TEST_COMPLETION_PROVIDER,
			model: TEST_COMPLETION_MODEL,
			execution: "recorded_replay",
			token_usage: { measurement: "unavailable" },
			external_billing: {
				classification: "none",
				amount_usd: 0,
				reason: "recorded_replay",
			},
		};
		return Promise.resolve(completion);
	});
}

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
	const modelCalls = mockDeterministicModelCompletions();
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

	// All four production calls complete and cache before publish-edition's
	// mocked failure forces a step retry, so the retry repeats only the failed
	// step, not the model calls that already succeeded.
	expect(modelCalls).toHaveBeenCalledTimes(4);
	expect(modelCalls.mock.calls.map(([request]) => request.productionStep)).toEqual([
		"main_story_write",
		"main_story_copyedit",
		"announcements_write",
		"announcements_copyedit",
	]);
	const served = await readEdition(env.DB, "7", "2026-01-25");
	expect(served).toMatchObject({
		active_region_id: "7",
		meta: {
			editorial_products: {
				main_story: {
					write: { provider: TEST_COMPLETION_PROVIDER, model: TEST_COMPLETION_MODEL },
					copyedit: { provider: TEST_COMPLETION_PROVIDER, model: TEST_COMPLETION_MODEL },
				},
				announcements: {
					write: { provider: TEST_COMPLETION_PROVIDER, model: TEST_COMPLETION_MODEL },
					copyedit: { provider: TEST_COMPLETION_PROVIDER, model: TEST_COMPLETION_MODEL },
				},
			},
		},
	});
	await expect(
		readGenerationRunStatus(env.DB, { active_region_id: "7", publication_date: "2026-01-25" }),
	).resolves.toMatchObject({
		state: "complete",
		completed_steps: [
			"prepare-evidence",
			"main_story_write",
			"main_story_copyedit",
			"announcements_write",
			"announcements_copyedit",
			"validate-edition",
			"publish-edition",
		],
		model_usage: [
			{ production_step: "main_story_write" },
			{ production_step: "main_story_copyedit" },
			{ production_step: "announcements_write" },
			{ production_step: "announcements_copyedit" },
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
	const modelCalls = mockDeterministicModelCompletions();
	await using instance = await introspectWorkflowInstance(env.GENERATION_RUN, "generation-run-7-2026-01-26");
	await instance.modify(async (m) => {
		await m.disableRetryDelays();
		await m.mockStepError({ name: "record-main-story-write-status" }, new Error("transient status failure"), 1);
	});
	await env.GENERATION_RUN.create({ id: "generation-run-7-2026-01-26", params });
	await instance.waitForStatus("complete");
	expect(modelCalls).toHaveBeenCalledTimes(4);
	await expect(readGenerationRunStatus(env.DB, params)).resolves.toMatchObject({
		state: "complete",
		model_usage: [
			{ production_step: "main_story_write" },
			{ production_step: "main_story_copyedit" },
			{ production_step: "announcements_write" },
			{ production_step: "announcements_copyedit" },
		],
	});
});

it("schema-valid copyedit findings publish after one pass and remain durable diagnostics", async () => {
	const params = { active_region_id: "7", publication_date: "2026-01-27" } as const;
	await env.DB.prepare(
		`INSERT INTO chat_messages (
		 entity_id, region_id, channel_id, username_raw, username, text, timestamp_utc, timestamp_ts
		) VALUES ('generation-run-test-msg-3', 7, 1, 'en/Someone', 'Someone',
		 'one more message worth reporting', '2026-01-26T12:00:00Z', ?1)`,
	).bind(Date.UTC(2026, 0, 26, 12)).run();
	await queueGenerationRunStatus(env.DB, params, "2026-08-04T23:00:00.000Z");
	const modelCalls = mockDeterministicModelCompletions((outputs) => {
		const output = JSON.parse(outputs.main_story_copyedit) as { main_story: { body: string } };
		output.main_story.body = "**Mallory** reported 2 claims.\n\nThey called it “invented words”—and cited a system prompt.";
		outputs.main_story_copyedit = JSON.stringify(output);
	});
	await using instance = await introspectWorkflowInstance(
		env.GENERATION_RUN,
		"generation-run-7-2026-01-27",
	);
	await instance.modify(async (m) => {
		await m.disableRetryDelays();
	});
	await env.GENERATION_RUN.create({ id: "generation-run-7-2026-01-27", params });
	await instance.waitForStatus("complete");
	expect(modelCalls).toHaveBeenCalledTimes(4);
	await expect(readEdition(env.DB, "7", "2026-01-27")).resolves.toMatchObject({
		main_story: {
			body: "**Mallory** reported 2 claims.\n\nThey called it “invented words”—and cited a system prompt.",
		},
	});
	await expect(readGenerationRunStatus(env.DB, params)).resolves.toMatchObject({
		state: "complete",
		diagnostics: [
			{ kind: "preservation", production_step: "main_story_copyedit", code: "paragraph_count" },
			{ kind: "preservation", production_step: "main_story_copyedit", code: "quoted_span" },
			{ kind: "preservation", production_step: "main_story_copyedit", code: "numeric_literal" },
			{ kind: "preservation", production_step: "main_story_copyedit", code: "protected_markdown" },
			{ kind: "final_product", production_step: "main_story_copyedit", code: "forbidden_marker" },
			{ kind: "final_product", production_step: "main_story_copyedit", code: "forbidden_marker" },
			{ kind: "final_product", production_step: "main_story_copyedit", code: "ungrounded_marked_name" },
			{ kind: "final_product", production_step: "main_story_copyedit", code: "ungrounded_quote" },
		],
		failure: null,
	});
});

it.each([
	["malformed JSON", "not json", "invalid_json"],
	["schema mismatch", JSON.stringify({ title: "Incomplete" }), "contract_mismatch"],
] as const)("%s from copyedit remains terminal", async (_label, copyeditOutput, code) => {
	const publicationDate = code === "invalid_json" ? "2026-01-28" : "2026-01-29";
	const params = { active_region_id: "7", publication_date: publicationDate } as const;
	await env.DB.prepare(
		`INSERT INTO chat_messages (
		 entity_id, region_id, channel_id, username_raw, username, text, timestamp_utc, timestamp_ts
		) VALUES (?1, 7, 1, 'en/Someone', 'Someone',
		 'schema boundary evidence', ?2, ?3)`,
	).bind(
		`generation-run-test-${code}`,
		`${publicationDate.slice(0, -2)}${String(Number(publicationDate.slice(-2)) - 1).padStart(2, "0")}T12:00:00Z`,
		Date.parse(`${publicationDate.slice(0, -2)}${String(Number(publicationDate.slice(-2)) - 1).padStart(2, "0")}T12:00:00Z`),
	).run();
	await queueGenerationRunStatus(env.DB, params, "2026-08-04T23:00:00.000Z");
	const modelCalls = mockDeterministicModelCompletions((outputs) => {
		outputs.main_story_copyedit = copyeditOutput;
	});
	await using instance = await introspectWorkflowInstance(
		env.GENERATION_RUN,
		`generation-run-7-${publicationDate}`,
	);
	await instance.modify(async (m) => {
		await m.disableRetryDelays();
	});
	await env.GENERATION_RUN.create({ id: `generation-run-7-${publicationDate}`, params });
	await instance.waitForStatus("errored");
	const productionSteps = modelCalls.mock.calls.map(([request]) => request.productionStep);
	expect(productionSteps[0]).toBe("main_story_write");
	expect(new Set(productionSteps)).toEqual(new Set(["main_story_write", "main_story_copyedit"]));
	await expect(readEdition(env.DB, "7", publicationDate)).resolves.toBeUndefined();
	await expect(readGenerationRunStatus(env.DB, params)).resolves.toMatchObject({
		state: "errored",
		completed_steps: ["prepare-evidence", "main_story_write"],
		diagnostics: [],
		failure: { step: "main_story_copyedit", code },
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
