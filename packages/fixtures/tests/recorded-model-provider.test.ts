import { expect, test } from "vitest";
import { EvidenceFixtureSchema } from "@bc-news/contracts";
import {
	prepareEvidenceWithGameReferences,
} from "@bc-news/generation-core";
import {
	RecordedModelResponseSchema,
	RecordedModelResponseV2Schema,
	RecordedModelResponseV3Schema,
	createRecordedModelProvider,
	fixtureGameReferenceResolver,
	type RecordedModelResponseRoster,
} from "../src";
import announcementsWriteResponseJson from "../model-responses/announcements_write.json";
import entityReferenceFixtureJson from "../evidence/entity-reference-links.json";
import mainStoryWriteResponseJson from "../model-responses/main_story_write.json";

const committedRoster: RecordedModelResponseRoster = {
	main_story_write: RecordedModelResponseSchema.parse(mainStoryWriteResponseJson),
	announcements_write: RecordedModelResponseSchema.parse(announcementsWriteResponseJson),
};

test("keeps the committed strict v3 response contract limited to the two writers", () => {
	expect(Object.keys(committedRoster)).toEqual(["main_story_write", "announcements_write"]);
	for (const candidate of [
		mainStoryWriteResponseJson,
		announcementsWriteResponseJson,
	]) {
		const response = RecordedModelResponseSchema.parse(candidate);
		expect("version" in response && response.version).toBe(3);
		if (!("version" in response) || response.version !== 3) {
			throw new Error("Expected a strict v3 recorded response");
		}
		expect(response.configuration).toEqual(expect.objectContaining({
			adapter: "openai_compatible_hosted",
			provider: "synthetic_fixture",
		}));
	}
});

test.each([
	["provider-default LM Studio", { adapter: "lmstudio", posture: "provider_default" }],
	["explicit LM Studio", {
		adapter: "lmstudio",
		posture: "explicit",
		config: { temperature: 0.25, top_p: 0.9, top_k: 40 },
	}],
	["hosted not-applicable", {
		adapter: "openai_compatible_hosted",
		posture: "not_applicable",
	}],
] as const)("accepts strict v2 %s sampling evidence", (_name, sampling) => {
	const { configuration, ...legacyCompatibleResponse } = mainStoryWriteResponseJson;
	void configuration;
	const response = RecordedModelResponseV2Schema.parse({
		...legacyCompatibleResponse,
		version: 2,
		sampling,
	});
	expect(response.sampling).toEqual(sampling);
	expect(RecordedModelResponseSchema.parse(response)).toEqual(response);
});

test("accepts strict v3 inference configuration and rejects invalid decoding controls", () => {
	const response = RecordedModelResponseV3Schema.parse({
		...mainStoryWriteResponseJson,
		version: 3,
		configuration: {
			adapter: "lmstudio",
			model: "local/main-story-writer",
			temperature: 0.7,
			top_p: 0.95,
			top_k: 20,
			enable_thinking: false,
			reasoning_effort: "provider_default",
		},
	});
	expect(response.configuration).toMatchObject({
		temperature: 0.7,
		top_p: 0.95,
		top_k: 20,
		enable_thinking: false,
	});
	expect(RecordedModelResponseSchema.parse(response)).toEqual(response);
	for (const configuration of [
		{ ...response.configuration, temperature: 2.1 },
		{ ...response.configuration, sampling: { temperature: 0, top_p: 1, top_k: 40 } },
		{ ...response.configuration, top_p: 1.1 },
		{ ...response.configuration, top_k: 0 },
		{ ...response.configuration, enable_thinking: "false" },
	]) {
		expect(RecordedModelResponseV3Schema.safeParse({ ...response, configuration }).success).toBe(false);
	}
});

function gameReferencePreparedEvidence() {
	const fixture = EvidenceFixtureSchema.parse(entityReferenceFixtureJson);
	return prepareEvidenceWithGameReferences({
		activeRegionId: fixture.active_region_id,
		publicationDate: "2026-08-17",
		messages: fixture.messages,
	}, fixtureGameReferenceResolver);
}

test("the committed main-story writer fixture remains schema-valid and evidence-grounded enough to publish", async () => {
	const preparedEvidence = await gameReferencePreparedEvidence();
	const draft = JSON.parse(mainStoryWriteResponseJson.text) as {
		main_story?: { body?: string };
	};

	expect(draft.main_story?.body).toContain("[[GAME_REF_001]]");
	expect(draft.main_story?.body).toContain("Katlin asked whether the gear carried different buffs");
	expect(preparedEvidence.game_references).toEqual([
		expect.objectContaining({
			token: "[[GAME_REF_001]]",
			kind: "item",
			id: "163977632",
			display_text: "Ornate Leather Shirt",
		}),
	]);
	expect(preparedEvidence.messages.some((message) => message.text.includes("(item=264387410)"))).toBe(true);
});

test("a replay factory rejects a response assigned to a different production step", async () => {
	const provider = createRecordedModelProvider({
		...committedRoster,
		main_story_write: committedRoster.announcements_write,
	});

	await expect(provider.complete({
		productionStep: "main_story_write",
		system: "unused",
		user: "unused",
	})).rejects.toEqual(expect.objectContaining({
		name: "RecordedModelProviderError",
		code: "recorded_response_step_mismatch",
		productionStep: "main_story_write",
	}));
});

test("a replay factory validates the selected retained response", async () => {
	const retainedResponseWithExtraKey = {
		...committedRoster.main_story_write,
		judge: null,
	};
	const provider = createRecordedModelProvider({
		...committedRoster,
		main_story_write: retainedResponseWithExtraKey,
	});

	await expect(provider.complete({
		productionStep: "main_story_write",
		system: "unused",
		user: "unused",
	})).rejects.toEqual(expect.objectContaining({ name: "ZodError" }));
});

test("replays v2 response text without treating sampling evidence as an instruction", async () => {
	const { configuration, ...legacyCompatibleResponse } = mainStoryWriteResponseJson;
	void configuration;
	const currentResponse = RecordedModelResponseV2Schema.parse({
		...legacyCompatibleResponse,
		version: 2,
		sampling: {
			adapter: "lmstudio",
			posture: "explicit",
			config: { temperature: 0.5, top_p: 0.8, top_k: 30 },
		},
	});
	const provider = createRecordedModelProvider({
		...committedRoster,
		main_story_write: currentResponse,
	});

	const completion = await provider.complete({
		productionStep: "main_story_write",
		system: "unused",
		user: "unused",
	});
	expect(completion.text).toBe(mainStoryWriteResponseJson.text);
	expect(completion.provider).toBe(mainStoryWriteResponseJson.provider);
	expect(completion.model).toBe(mainStoryWriteResponseJson.model);
});

test("replays v3 response text without treating retained configuration as an instruction", async () => {
	const currentResponse = RecordedModelResponseV3Schema.parse({
		...mainStoryWriteResponseJson,
		configuration: {
			adapter: "lmstudio",
			model: "local/main-story-writer",
			temperature: 0.7,
			top_p: 0.95,
			top_k: 20,
			enable_thinking: false,
			reasoning_effort: "provider_default",
		},
	});
	const provider = createRecordedModelProvider({ ...committedRoster, main_story_write: currentResponse });
	const completion = await provider.complete({
		productionStep: "main_story_write",
		system: "unused",
		user: "unused",
	});
	expect(completion.text).toBe(mainStoryWriteResponseJson.text);
	expect(completion.provider).toBe(mainStoryWriteResponseJson.provider);
	expect(completion.model).toBe(mainStoryWriteResponseJson.model);
});
