import { expect, test } from "vitest";
import {
	COPYEDIT_SYSTEM_CONSTRAINTS,
	WRITER_SYSTEM_CONSTRAINTS,
	attachAnnouncementIds,
	buildAnnouncementsCopyeditPrompt,
	buildAnnouncementsWriterPrompt,
	buildMainStoryCopyeditPrompt,
	buildMainStoryWriterPrompt,
	parseAnnouncementsWriterOutput,
	parseMainStoryWriterOutput,
	prepareEvidence,
} from "@bc-news/generation-core";
import {
	RecordedModelResponseSchema,
	RecordedModelResponseV2Schema,
	createRecordedModelProvider,
	fixtureEvidenceInput,
	modelRequestSha256,
	recordedModelProvider,
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

test("replays the exact dependent requests used by the real workflow", async () => {
	const preparedEvidence = await canonicalPreparedEvidence();
	const mainStoryDraftCompletion = await recordedModelProvider.complete({
		productionStep: "main_story_write",
		system: WRITER_SYSTEM_CONSTRAINTS,
		user: buildMainStoryWriterPrompt(preparedEvidence),
	});
	const mainStoryDraft = parseMainStoryWriterOutput(mainStoryDraftCompletion.text);
	const mainStoryCopyeditCompletion = await recordedModelProvider.complete({
		productionStep: "main_story_copyedit",
		system: COPYEDIT_SYSTEM_CONSTRAINTS,
		user: buildMainStoryCopyeditPrompt(mainStoryDraft),
	});
	const announcementsDraftCompletion = await recordedModelProvider.complete({
		productionStep: "announcements_write",
		system: WRITER_SYSTEM_CONSTRAINTS,
		user: buildAnnouncementsWriterPrompt(preparedEvidence),
	});
	const announcementsDraft = parseAnnouncementsWriterOutput(announcementsDraftCompletion.text);
	const announcementsCopyeditCompletion = await recordedModelProvider.complete({
		productionStep: "announcements_copyedit",
		system: COPYEDIT_SYSTEM_CONSTRAINTS,
		user: buildAnnouncementsCopyeditPrompt(attachAnnouncementIds(announcementsDraft)),
	});

	for (const completion of [
		mainStoryDraftCompletion,
		mainStoryCopyeditCompletion,
		announcementsDraftCompletion,
		announcementsCopyeditCompletion,
	]) {
		expect(completion.execution).toBe("recorded_replay");
		expect(completion.token_usage).toEqual({ measurement: "unavailable" });
		expect(completion.external_billing).toEqual({
			classification: "none",
			amount_usd: 0,
			reason: "recorded_replay",
		});
	}
});

test.each(["system", "user"] as const)("rejects a replay when the real %s prompt bytes differ", async (field) => {
	const preparedEvidence = await canonicalPreparedEvidence();
	const request = {
		productionStep: "main_story_write" as const,
		system: WRITER_SYSTEM_CONSTRAINTS,
		user: buildMainStoryWriterPrompt(preparedEvidence),
	};
	const mismatchedRequest = { ...request, [field]: `${request[field]} changed` };
	const requestSha256 = await modelRequestSha256(mismatchedRequest);
	const recordedPromptSha256 = RecordedModelResponseSchema.parse(
		mainStoryWriteResponseJson,
	).prompt_sha256;
	expect(recordedPromptSha256).not.toBe(requestSha256);

	await expect(recordedModelProvider.complete(mismatchedRequest)).rejects.toEqual(
		expect.objectContaining({
			name: "RecordedModelProviderError",
			code: "recorded_response_prompt_mismatch",
			productionStep: "main_story_write",
			message: `Recorded response prompt_sha256 "${recordedPromptSha256}" does not match request sha256 "${requestSha256}" for production step "main_story_write"`,
		}),
	);
});

test("a replay factory rejects a response assigned to a different production step", async () => {
	const preparedEvidence = await canonicalPreparedEvidence();
	const provider = createRecordedModelProvider({
		...committedRoster,
		main_story_write: committedRoster.announcements_write,
	});

	await expect(provider.complete({
		productionStep: "main_story_write",
		system: WRITER_SYSTEM_CONSTRAINTS,
		user: buildMainStoryWriterPrompt(preparedEvidence),
	})).rejects.toEqual(expect.objectContaining({
		name: "RecordedModelProviderError",
		code: "recorded_response_step_mismatch",
		productionStep: "main_story_write",
	}));
});

test("a replay factory validates the selected retained response", async () => {
	const preparedEvidence = await canonicalPreparedEvidence();
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
		system: WRITER_SYSTEM_CONSTRAINTS,
		user: buildMainStoryWriterPrompt(preparedEvidence),
	})).rejects.toEqual(expect.objectContaining({ name: "ZodError" }));
});

test("replays v2 response text without treating sampling evidence as an instruction", async () => {
	const preparedEvidence = await canonicalPreparedEvidence();
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
		system: WRITER_SYSTEM_CONSTRAINTS,
		user: buildMainStoryWriterPrompt(preparedEvidence),
	});
	expect(completion.text).toBe(mainStoryWriteResponseJson.text);
	expect(completion.provider).toBe(mainStoryWriteResponseJson.provider);
	expect(completion.model).toBe(mainStoryWriteResponseJson.model);
});
