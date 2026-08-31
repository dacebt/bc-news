import { introspectWorkflowInstance } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";
import {
	CURRENT_EDITION_VERSION,
	GenerationRunParamsSchema,
} from "@bc-news/contracts";
import { recordedModelProvider } from "@bc-news/fixtures";
import type { ModelCompletion } from "@bc-news/generation-core";
import { readEdition } from "../src/edition-store";
import {
	PREVIOUS_CURRENT_GENERATION_RUN_CONTRACT_VERSION,
	queueGenerationRunStatus,
	readGenerationRunStatus,
} from "../src/generation-run-status";
import * as configModule from "../src/config";

afterEach(() => {
	vi.restoreAllMocks();
});

const TEST_COMPLETION_PROVIDER = "test_double";
const TEST_COMPLETION_MODEL = "deterministic/editorial-workflow-v2";

function mockDeterministicModelCompletions(
	mutateOutputs?: (
		outputs: Record<"main_story_write" | "announcements_write", string | string[]>,
	) => void,
) {
	const outputs: Record<"main_story_write" | "announcements_write", string | string[]> = {
		main_story_write: JSON.stringify({
			title: "The Daily Dispatch",
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
		};
	mutateOutputs?.(outputs);
	const callCounts = {
		main_story_write: 0,
		announcements_write: 0,
	};

	return vi.spyOn(recordedModelProvider, "complete").mockImplementation((request) => {
		const candidate = outputs[request.productionStep];
		const callIndex = callCounts[request.productionStep];
		callCounts[request.productionStep] += 1;
		const text = Array.isArray(candidate)
			? candidate[Math.min(callIndex, candidate.length - 1)] ?? null
			: candidate;
		const completion: ModelCompletion = {
			text,
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

async function seedChatMessage(params: {
	id: string;
	regionId: number;
	text: string;
	timestampUtc: string;
}): Promise<void> {
	await env.DB.prepare(
		`INSERT INTO chat_messages (
			entity_id, region_id, channel_id, username_raw, username, text, timestamp_utc, timestamp_ts
		) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
	)
		.bind(
			params.id,
			params.regionId,
			1,
			"en/Someone",
			"Someone",
			params.text,
			params.timestampUtc,
			Date.parse(params.timestampUtc),
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

it("interrupted run does not repeat either writer model call", async () => {
	await seedChatMessage({
		id: "generation-run-test-msg-1",
		regionId: 7,
		text: "a message worth reporting",
		timestampUtc: "2026-01-24T12:00:00Z",
	});
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

	expect(modelCalls).toHaveBeenCalledTimes(2);
	expect(modelCalls.mock.calls.map(([request]) => request.productionStep)).toEqual([
		"main_story_write",
		"announcements_write",
	]);
	const served = await readEdition(env.DB, "7", "2026-01-25");
	expect(served).toMatchObject({
		version: CURRENT_EDITION_VERSION,
		active_region_id: "7",
		game_references: [],
		meta: {
			editorial_products: {
				main_story: { provider: TEST_COMPLETION_PROVIDER, model: TEST_COMPLETION_MODEL },
				announcements: { provider: TEST_COMPLETION_PROVIDER, model: TEST_COMPLETION_MODEL },
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
			"announcements_write",
			"validate-edition",
			"publish-edition",
		],
		model_usage: [
			{ production_step: "main_story_write" },
			{ production_step: "announcements_write" },
		],
	});
});

it("a retried status write does not repeat the completed main-story writer call", async () => {
	const params = { active_region_id: "7", publication_date: "2026-01-26" } as const;
	await seedChatMessage({
		id: "generation-run-test-msg-2",
		regionId: 7,
		text: "another message worth reporting",
		timestampUtc: "2026-01-25T12:00:00Z",
	});
	await queueGenerationRunStatus(env.DB, params, "2026-08-04T23:00:00.000Z");
	const modelCalls = mockDeterministicModelCompletions();
	await using instance = await introspectWorkflowInstance(env.GENERATION_RUN, "generation-run-7-2026-01-26");
	await instance.modify(async (m) => {
		await m.disableRetryDelays();
		await m.mockStepError({ name: "record-main-story-write-status" }, new Error("transient status failure"), 1);
	});
	await env.GENERATION_RUN.create({ id: "generation-run-7-2026-01-26", params });
	await instance.waitForStatus("complete");
	expect(modelCalls).toHaveBeenCalledTimes(2);
	await expect(readGenerationRunStatus(env.DB, params)).resolves.toMatchObject({
		state: "complete",
		model_usage: [
			{ production_step: "main_story_write" },
			{ production_step: "announcements_write" },
		],
	});
});

it("schema-valid writer findings publish after one pass and remain durable diagnostics", async () => {
	const params = { active_region_id: "7", publication_date: "2026-01-27" } as const;
	await seedChatMessage({
		id: "generation-run-test-msg-3",
		regionId: 7,
		text: "one more message worth reporting",
		timestampUtc: "2026-01-26T12:00:00Z",
	});
	await queueGenerationRunStatus(env.DB, params, "2026-08-04T23:00:00.000Z");
	const modelCalls = mockDeterministicModelCompletions((outputs) => {
		const currentOutput = outputs.main_story_write;
		if (typeof currentOutput !== "string") throw new Error("Expected a single main_story_write output");
		const output = JSON.parse(currentOutput) as { main_story: { body: string } };
		output.main_story.body = "**Mallory** reported 2 claims.\n\nThey called it “invented words”—and cited a system prompt.";
		outputs.main_story_write = JSON.stringify(output);
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
	expect(modelCalls).toHaveBeenCalledTimes(2);
	await expect(readEdition(env.DB, "7", "2026-01-27")).resolves.toMatchObject({
		main_story: {
			body: "**Mallory** reported 2 claims.\n\nThey called it “invented words”—and cited a system prompt.",
		},
	});
	await expect(readGenerationRunStatus(env.DB, params)).resolves.toMatchObject({
		state: "complete",
		diagnostics: [
			{ kind: "final_product", production_step: "main_story_write", code: "forbidden_marker" },
			{ kind: "final_product", production_step: "main_story_write", code: "forbidden_marker" },
			{ kind: "final_product", production_step: "main_story_write", code: "ungrounded_marked_name" },
			{ kind: "final_product", production_step: "main_story_write", code: "ungrounded_quote" },
		],
		failure: null,
	});
});

it.each([
	["malformed JSON", "2026-01-28", "not json", "invalid_json"],
	["schema mismatch", "2026-01-29", JSON.stringify({ title: "Incomplete" }), "contract_mismatch"],
] as const)(
	"retries one mechanically invalid main-writer %s and publishes on the second attempt",
	async (_label, publicationDate, firstWriterOutput, code) => {
		const params = { active_region_id: "7", publication_date: publicationDate } as const;
		await seedChatMessage({
			id: `generation-run-test-${code}`,
			regionId: 7,
			text: "schema boundary evidence",
			timestampUtc: `${publicationDate.slice(0, -2)}${String(Number(publicationDate.slice(-2)) - 1).padStart(2, "0")}T12:00:00Z`,
		});
		await queueGenerationRunStatus(env.DB, params, "2026-08-04T23:00:00.000Z");
		const modelCalls = mockDeterministicModelCompletions((outputs) => {
			outputs.main_story_write = [
				firstWriterOutput,
				JSON.stringify({
					title: "Recovered Dispatch",
					main_story: {
						headline: "Retry Found the Story",
						lede: "The second pass returned a valid dispatch.",
						body: "Someone shared a message worth reporting with the region.",
					},
				}),
			];
		});
		await using instance = await introspectWorkflowInstance(
			env.GENERATION_RUN,
			`generation-run-7-${publicationDate}`,
		);
		await instance.modify(async (m) => {
			await m.disableRetryDelays();
		});
		await env.GENERATION_RUN.create({ id: `generation-run-7-${publicationDate}`, params });
		await instance.waitForStatus("complete");

		expect(modelCalls.mock.calls.map(([request]) => request.productionStep)).toEqual([
			"main_story_write",
			"main_story_write",
			"announcements_write",
		]);
			expect(
				modelCalls.mock.calls.map(([request]) => request.correlation?.invocation_id),
			).toEqual([
				`generation-run-7-${publicationDate}-main_story_write-attempt-1`,
				`generation-run-7-${publicationDate}-main_story_write-attempt-2`,
			`generation-run-7-${publicationDate}-announcements_write-attempt-1`,
		]);
		await expect(readEdition(env.DB, "7", publicationDate)).resolves.toMatchObject({
			title: "Recovered Dispatch",
		});
		await expect(readGenerationRunStatus(env.DB, params)).resolves.toMatchObject({
			state: "complete",
			completed_steps: [
				"prepare-evidence",
				"main_story_write",
				"announcements_write",
				"validate-edition",
				"publish-edition",
			],
			model_usage: [
				{ production_step: "main_story_write" },
				{ production_step: "announcements_write" },
			],
			model_attempts: [
				{
					production_step: "main_story_write",
					attempt: 1,
					outcome: { status: "rejected", code },
				},
				{
					production_step: "main_story_write",
					attempt: 2,
					outcome: { status: "accepted" },
				},
				{
					production_step: "announcements_write",
					attempt: 1,
					outcome: { status: "accepted" },
				},
			],
			failure: null,
		});
	},
);

it("ends the run after a second mechanical main-writer rejection", async () => {
	const params = { active_region_id: "7", publication_date: "2026-02-01" } as const;
	await seedChatMessage({
		id: "generation-run-double-main-reject",
		regionId: 7,
		text: "schema exhaustion evidence",
		timestampUtc: "2026-01-31T12:00:00Z",
	});
	await queueGenerationRunStatus(env.DB, params, "2026-08-04T23:00:00.000Z");
	const modelCalls = mockDeterministicModelCompletions((outputs) => {
		outputs.main_story_write = ["not json", JSON.stringify({ title: "Incomplete" })];
	});
	await using instance = await introspectWorkflowInstance(
		env.GENERATION_RUN,
		"generation-run-7-2026-02-01",
	);
	await instance.modify(async (m) => {
		await m.disableRetryDelays();
	});
	await env.GENERATION_RUN.create({ id: "generation-run-7-2026-02-01", params });
	await instance.waitForStatus("errored");

	expect(modelCalls.mock.calls.map(([request]) => request.productionStep)).toEqual([
		"main_story_write",
		"main_story_write",
	]);
	await expect(readEdition(env.DB, "7", "2026-02-01")).resolves.toBeUndefined();
	await expect(readGenerationRunStatus(env.DB, params)).resolves.toMatchObject({
		state: "errored",
		completed_steps: ["prepare-evidence"],
		model_usage: [],
		model_attempts: [
			{
				production_step: "main_story_write",
				attempt: 1,
				outcome: { status: "rejected", code: "invalid_json" },
			},
			{
				production_step: "main_story_write",
				attempt: 2,
				outcome: { status: "rejected", code: "contract_mismatch" },
			},
		],
		failure: { step: "main_story_write", code: "contract_mismatch" },
	});
});

it("retries only the announcements writer after a mechanical rejection", async () => {
	const params = { active_region_id: "7", publication_date: "2026-02-02" } as const;
	await seedChatMessage({
		id: "generation-run-announcements-retry",
		regionId: 7,
		text: "announcement retry evidence",
		timestampUtc: "2026-02-01T12:00:00Z",
	});
	await queueGenerationRunStatus(env.DB, params, "2026-08-04T23:00:00.000Z");
	const modelCalls = mockDeterministicModelCompletions((outputs) => {
		outputs.announcements_write = [
			"not json",
			JSON.stringify({
				announcements: [
					{
						title: "Recovered Notice",
						summary: "Someone shared a message worth reporting with the region.",
					},
				],
			}),
		];
	});
	await using instance = await introspectWorkflowInstance(
		env.GENERATION_RUN,
		"generation-run-7-2026-02-02",
	);
	await instance.modify(async (m) => {
		await m.disableRetryDelays();
	});
	await env.GENERATION_RUN.create({ id: "generation-run-7-2026-02-02", params });
	await instance.waitForStatus("complete");

	expect(modelCalls.mock.calls.map(([request]) => request.productionStep)).toEqual([
		"main_story_write",
		"announcements_write",
		"announcements_write",
	]);
	await expect(readEdition(env.DB, "7", "2026-02-02")).resolves.toMatchObject({
		announcements: [{ title: "Recovered Notice" }],
	});
	await expect(readGenerationRunStatus(env.DB, params)).resolves.toMatchObject({
		state: "complete",
		model_usage: [
			{ production_step: "main_story_write" },
			{ production_step: "announcements_write" },
		],
		model_attempts: [
			{
				production_step: "main_story_write",
				attempt: 1,
				outcome: { status: "accepted" },
			},
			{
				production_step: "announcements_write",
				attempt: 1,
				outcome: { status: "rejected", code: "invalid_json" },
			},
			{
				production_step: "announcements_write",
				attempt: 2,
				outcome: { status: "accepted" },
			},
		],
	});
});

it("does not retry a non-contract writer failure", async () => {
	const params = { active_region_id: "7", publication_date: "2026-02-03" } as const;
	await seedChatMessage({
		id: "generation-run-non-contract-failure",
		regionId: 7,
		text: "provider failure evidence",
		timestampUtc: "2026-02-02T12:00:00Z",
	});
	await queueGenerationRunStatus(env.DB, params, "2026-08-04T23:00:00.000Z");
	const modelCalls = vi.spyOn(recordedModelProvider, "complete").mockRejectedValue(new Error("provider unavailable"));
	await using instance = await introspectWorkflowInstance(
		env.GENERATION_RUN,
		"generation-run-7-2026-02-03",
	);
	await instance.modify(async (m) => {
		await m.disableRetryDelays();
	});
	await env.GENERATION_RUN.create({ id: "generation-run-7-2026-02-03", params });
	await instance.waitForStatus("errored");

	expect(modelCalls).toHaveBeenCalledTimes(3);
	expect(
		new Set(modelCalls.mock.calls.map(([request]) => request.correlation?.invocation_id)),
	).toEqual(new Set(["generation-run-7-2026-02-03-main_story_write-attempt-1"]));
	await expect(readGenerationRunStatus(env.DB, params)).resolves.toMatchObject({
		state: "errored",
		model_attempts: [],
		failure: { step: "main_story_write", code: "generation_run_failed", message: "provider unavailable" },
	});
});

it("does not grant the mechanical retry to a current_v1 run", async () => {
	const params = { active_region_id: "7", publication_date: "2026-02-04" } as const;
	await seedChatMessage({
		id: "generation-run-current-v1",
		regionId: 7,
		text: "current_v1 compatibility evidence",
		timestampUtc: "2026-02-03T12:00:00Z",
	});
	await env.DB.prepare(
		`INSERT INTO generation_run_status (
		 contract_version, active_region_id, publication_date, state, current_step, completed_steps_json,
		 model_usage_json, diagnostics_json, failure_json, created_at_utc, updated_at_utc
		) VALUES (?1, ?2, ?3, 'queued', NULL, '[]', '[]', '[]', NULL, ?4, ?4)`,
	).bind(
		PREVIOUS_CURRENT_GENERATION_RUN_CONTRACT_VERSION,
		params.active_region_id,
		params.publication_date,
		"2026-08-04T23:00:00.000Z",
	).run();
	const modelCalls = mockDeterministicModelCompletions((outputs) => {
		outputs.main_story_write = "not json";
	});
	await using instance = await introspectWorkflowInstance(
		env.GENERATION_RUN,
		"generation-run-7-2026-02-04",
	);
	await instance.modify(async (m) => {
		await m.disableRetryDelays();
	});
	await env.GENERATION_RUN.create({ id: "generation-run-7-2026-02-04", params });
	await instance.waitForStatus("errored");

	expect(modelCalls).toHaveBeenCalledTimes(1);
	const status = await readGenerationRunStatus(env.DB, params);
	expect(status).toMatchObject({
		contract_version: PREVIOUS_CURRENT_GENERATION_RUN_CONTRACT_VERSION,
		state: "errored",
		failure: { step: "main_story_write", code: "invalid_json" },
	});
	if (status === undefined) throw new Error("Expected current_v1 generation run status");
	expect(Object.hasOwn(status, "model_attempts")).toBe(false);
});

it("publishes retained coordinate references while leaving rich prose tokens intact", async () => {
	const params = { active_region_id: "7", publication_date: "2026-01-30" } as const;
	await seedChatMessage({
		id: "generation-run-test-msg-5",
		regionId: 7,
		text: "Meet me at [South Gate](coord=3745,3857).",
		timestampUtc: "2026-01-29T12:00:00Z",
	});
	await queueGenerationRunStatus(env.DB, params, "2026-08-04T23:00:00.000Z");
	const modelCalls = mockDeterministicModelCompletions((outputs) => {
		outputs.main_story_write = JSON.stringify({
			title: "Word from [[GAME_REF_001]]",
			main_story: {
				headline: "Watch Holds at [[GAME_REF_001]]",
				lede: "[[AUTHOR_001]] checked in from [[GAME_REF_001]].",
				body: "**[[AUTHOR_001]]** checked in from [[GAME_REF_001]].",
			},
		});
		outputs.announcements_write = JSON.stringify({
			announcements: [{
				title: "Scouts Gather at [[GAME_REF_001]]",
				summary: "**[[AUTHOR_001]]** checked in from [[GAME_REF_001]].",
			}],
		});
	});
	await using instance = await introspectWorkflowInstance(
		env.GENERATION_RUN,
		"generation-run-7-2026-01-30",
	);
	await instance.modify(async (m) => {
		await m.disableRetryDelays();
	});
	await env.GENERATION_RUN.create({ id: "generation-run-7-2026-01-30", params });
	await instance.waitForStatus("complete");
	expect(modelCalls).toHaveBeenCalledTimes(2);
	await expect(readEdition(env.DB, "7", "2026-01-30")).resolves.toMatchObject({
		version: CURRENT_EDITION_VERSION,
		title: "Word from South Gate",
		game_references: [{
			token: "[[GAME_REF_001]]",
			kind: "coord",
			northing: 3745,
			easting: 3857,
			display_text: "South Gate",
			destination_url: "https://bitcraftmap.com/?center=3745,3857&zoom=3.0",
		}],
		main_story: {
			headline: "Watch Holds at South Gate",
			lede: "Someone checked in from South Gate.",
			body: "**Someone** checked in from [[GAME_REF_001]].",
		},
		announcements: [{
			title: "Scouts Gather at South Gate",
			summary: "**Someone** checked in from [[GAME_REF_001]].",
		}],
	});
});

it("resolves BitJita entity references during prepare-evidence with one resolver lookup", async () => {
	const params = { active_region_id: "7", publication_date: "2026-01-31" } as const;
	await seedChatMessage({
		id: "generation-run-test-msg-6",
		regionId: 7,
		text: "Bring extra stock for [timber](item=321).",
		timestampUtc: "2026-01-30T12:00:00Z",
	});
	await queueGenerationRunStatus(env.DB, params, "2026-08-04T23:00:00.000Z");
	const actualResolveGenerationPorts = configModule.resolveGenerationPorts;
	const resolverCalls: unknown[] = [];
	vi.spyOn(configModule, "resolveGenerationPorts").mockImplementation((currentEnv) => {
		const ports = actualResolveGenerationPorts(currentEnv);
		return {
			...ports,
			gameReferenceResolver: {
				resolve: (identities) => {
					resolverCalls.push(identities);
					return Promise.resolve([
						{ kind: "item", id: "321", outcome: "resolved", display_name: "Timber Bundle" },
					]);
				},
			},
		};
	});
	const modelCalls = mockDeterministicModelCompletions((outputs) => {
		outputs.main_story_write = JSON.stringify({
			title: "Supplies for [[GAME_REF_001]]",
			main_story: {
				headline: "Merchants Request [[GAME_REF_001]]",
				lede: "[[AUTHOR_001]] asked for [[GAME_REF_001]].",
				body: "[[AUTHOR_001]] asked for [[GAME_REF_001]].",
			},
		});
		outputs.announcements_write = JSON.stringify({
			announcements: [{
				title: "[[GAME_REF_001]] Requested",
				summary: "[[AUTHOR_001]] asked for [[GAME_REF_001]].",
			}],
		});
	});
	await using instance = await introspectWorkflowInstance(
		env.GENERATION_RUN,
		"generation-run-7-2026-01-31",
	);
	await instance.modify(async (m) => {
		await m.disableRetryDelays();
	});
	await env.GENERATION_RUN.create({ id: "generation-run-7-2026-01-31", params });
	await instance.waitForStatus("complete");

	expect(modelCalls).toHaveBeenCalledTimes(2);
	expect(resolverCalls).toEqual([[{ kind: "item", id: "321" }]]);
	await expect(readEdition(env.DB, "7", "2026-01-31")).resolves.toMatchObject({
		title: "Supplies for Timber Bundle",
		game_references: [{
			token: "[[GAME_REF_001]]",
			kind: "item",
			id: "321",
			display_text: "Timber Bundle",
		}],
		main_story: {
			headline: "Merchants Request Timber Bundle",
			lede: "Someone asked for Timber Bundle.",
			body: "**Someone** asked for [[GAME_REF_001]].",
		},
		announcements: [{
			title: "Timber Bundle Requested",
			summary: "**Someone** asked for [[GAME_REF_001]].",
		}],
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

it("final_count zero takes the existing no-evidence path before either writer", async () => {
	const params = { active_region_id: "8", publication_date: "2026-01-26" } as const;
	await seedChatMessage({
		id: "generation-run-test-msg-4",
		regionId: 8,
		text: " ",
		timestampUtc: "2026-01-25T12:00:00Z",
	});
	await queueGenerationRunStatus(env.DB, params, "2026-08-04T23:00:00.000Z");
	const modelCalls = mockDeterministicModelCompletions();
	await using instance = await introspectWorkflowInstance(env.GENERATION_RUN, "generation-run-8-2026-01-26");
	await instance.modify(async (m) => {
		await m.disableRetryDelays();
	});
	await env.GENERATION_RUN.create({ id: "generation-run-8-2026-01-26", params });
	await instance.waitForStatus("errored");
	expect(modelCalls).not.toHaveBeenCalled();
	await expect(readGenerationRunStatus(env.DB, params)).resolves.toMatchObject({
		state: "errored",
		completed_steps: [],
		model_usage: [],
		failure: { step: "prepare-evidence", code: "no_evidence_for_publication_date" },
	});
});
