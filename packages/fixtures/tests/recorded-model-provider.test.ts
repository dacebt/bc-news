import { expect, test } from "vitest";
import {
	mainStoryFinalProductDiagnostics,
	parseMainStoryCopyeditOutputWithDiagnostics,
	parseMainStoryWriterOutput,
	prepareEvidence,
} from "@bc-news/generation-core";
import {
	RecordedModelResponseSchema,
	RecordedModelResponseV2Schema,
	RecordedModelResponseV3Schema,
	createRecordedModelProvider,
	fixtureEvidenceInput,
	type RecordedModelResponseRoster,
} from "../src";
import announcementsCopyeditResponseJson from "../model-responses/announcements_copyedit.json";
import announcementsWriteResponseJson from "../model-responses/announcements_write.json";
import mainStoryCopyeditResponseJson from "../model-responses/main_story_copyedit.json";
import mainStoryWriteResponseJson from "../model-responses/main_story_write.json";

const committedRoster: RecordedModelResponseRoster = {
	main_story_write: RecordedModelResponseSchema.parse(mainStoryWriteResponseJson),
	main_story_copyedit: RecordedModelResponseSchema.parse(mainStoryCopyeditResponseJson),
	announcements_write: RecordedModelResponseSchema.parse(announcementsWriteResponseJson),
	announcements_copyedit: RecordedModelResponseSchema.parse(announcementsCopyeditResponseJson),
};

test("keeps the committed absent-version response contract strict and unchanged", () => {
	for (const candidate of [
		mainStoryWriteResponseJson,
		mainStoryCopyeditResponseJson,
		announcementsWriteResponseJson,
		announcementsCopyeditResponseJson,
	]) {
		const response = RecordedModelResponseSchema.parse(candidate);
		expect("version" in response).toBe(false);
		expect("sampling" in response).toBe(false);
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
	const response = RecordedModelResponseV2Schema.parse({
		...mainStoryWriteResponseJson,
		version: 2,
		sampling,
	});
	expect(response.sampling).toEqual(sampling);
	expect(RecordedModelResponseSchema.parse(response)).toEqual(response);
});

test("rejects partial, contradictory, and extra v2 sampling evidence", () => {
	const response = {
		...mainStoryWriteResponseJson,
		version: 2,
	};
	expect(RecordedModelResponseV2Schema.safeParse({
		...response,
		sampling: {
			adapter: "lmstudio",
			posture: "explicit",
			config: { temperature: 0, top_p: 1 },
		},
	}).success).toBe(false);
	expect(RecordedModelResponseV2Schema.safeParse({
		...response,
		sampling: {
			adapter: "lmstudio",
			posture: "provider_default",
			config: { temperature: 0, top_p: 1, top_k: 40 },
		},
	}).success).toBe(false);
	expect(RecordedModelResponseV2Schema.safeParse({
		...response,
		sampling: {
			adapter: "openai_compatible_hosted",
			posture: "not_applicable",
			config: { temperature: 0, top_p: 1, top_k: 40 },
		},
	}).success).toBe(false);
	expect(RecordedModelResponseSchema.safeParse({
		...response,
		version: 3,
		sampling: { adapter: "lmstudio", posture: "provider_default" },
	}).success).toBe(false);
});

test("accepts strict v3 independent agent configuration and rejects obsolete decoding controls", () => {
	const response = RecordedModelResponseV3Schema.parse({
		...mainStoryWriteResponseJson,
		version: 3,
		configuration: {
			adapter: "lmstudio",
			model: "local/main-story-writer",
			temperature: 0.7,
			reasoning_effort: "provider_default",
		},
	});
	expect(response.configuration).toHaveProperty("temperature", 0.7);
	expect(RecordedModelResponseSchema.parse(response)).toEqual(response);
	for (const configuration of [
		{ ...response.configuration, temperature: 2.1 },
		{ ...response.configuration, sampling: { temperature: 0, top_p: 1, top_k: 40 } },
		{ ...response.configuration, top_p: 1 },
		{ ...response.configuration, top_k: 40 },
	]) {
		expect(RecordedModelResponseV3Schema.safeParse({ ...response, configuration }).success).toBe(false);
	}
});

async function canonicalPreparedEvidence() {
	const messages = await fixtureEvidenceInput.loadEvidence({
		activeRegionId: "7",
		evidenceDate: "2026-01-24",
	});
	return prepareEvidence({
		activeRegionId: "7",
		publicationDate: "2026-01-25",
		messages,
	});
}

test("retains representative preservation and final-product diagnostics in the synthetic copyedit", async () => {
	const preparedEvidence = await canonicalPreparedEvidence();
	const draft = parseMainStoryWriterOutput(mainStoryWriteResponseJson.text);
	const copyedit = parseMainStoryCopyeditOutputWithDiagnostics(mainStoryCopyeditResponseJson.text, draft);

	expect([
		...copyedit.diagnostics,
		...mainStoryFinalProductDiagnostics(copyedit.product, preparedEvidence),
	]).toEqual([
		{
			kind: "preservation",
			production_step: "main_story_copyedit",
			code: "quoted_span",
			message: "Copyedit changed quoted spans or their order in main_story.body",
		},
		{
			kind: "preservation",
			production_step: "main_story_copyedit",
			code: "numeric_literal",
			message: "Copyedit changed numeric literals or their order in main_story.body",
		},
		{
			kind: "final_product",
			production_step: "main_story_copyedit",
			code: "forbidden_marker",
			message: "Forbidden output marker: —",
		},
		{
			kind: "final_product",
			production_step: "main_story_copyedit",
			code: "ungrounded_quote",
			message: "Ungrounded quote: damn R8 is doing T7 dungeons atm",
		},
	]);
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
	const currentResponse = RecordedModelResponseV2Schema.parse({
		...mainStoryWriteResponseJson,
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
		version: 3,
		configuration: {
			adapter: "lmstudio",
			model: "local/main-story-writer",
			temperature: 0.7,
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
});
