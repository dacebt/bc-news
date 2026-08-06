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
	fixtureEvidenceInput,
	modelRequestSha256,
	recordedModelProvider,
} from "../src";
import mainStoryWriteResponseJson from "../model-responses/main_story_write.json";

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

test("the retained response contract rejects extra keys", () => {
	expect(RecordedModelResponseSchema.safeParse({
		production_step: "main_story_write",
		provider: "fixture",
		model: "fixture",
		prompt_sha256: "0".repeat(64),
		text: "{}",
		judge: null,
	}).success).toBe(false);
});
