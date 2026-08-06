import { expect, test } from "vitest";
import { EvidenceFixtureSchema } from "@bc-news/contracts";
import {
	buildAnnouncementsCopyeditPrompt,
	buildAnnouncementsWriterPrompt,
	buildMainStoryCopyeditPrompt,
	buildMainStoryWriterPrompt,
	attachAnnouncementIds,
	parseAnnouncementsWriterOutput,
	parseMainStoryWriterOutput,
	prepareEvidence,
} from "@bc-news/generation-core";
import announcementsWriteJson from "../model-responses/announcements_write.json";
import evidenceJson from "../evidence/active-region-7_2026-01-24.json";
import mainStoryWriteJson from "../model-responses/main_story_write.json";
import { RecordedModelResponseSchema } from "../src/recorded-response";

const fixture = EvidenceFixtureSchema.parse(evidenceJson);
const prepared = prepareEvidence({
	activeRegionId: fixture.active_region_id,
	publicationDate: "2026-01-25",
	messages: fixture.messages,
});

test.each([
	["main story", buildMainStoryWriterPrompt],
	["announcements", buildAnnouncementsWriterPrompt],
] as const)("the %s writer receives the complete fenced prepared transcript", (_name, buildPrompt) => {
	const prompt = buildPrompt(prepared);
	expect(prompt).toContain(`Messages analyzed: ${String(prepared.final_count)}`);
	expect(prompt).toContain("[UNTRUSTED CHAT MESSAGE DATA]");
	expect(prompt).toContain("[END UNTRUSTED CHAT MESSAGE DATA]");
});

test("copyedit prompts carry only their typed draft, not source evidence", () => {
	const mainRecord = RecordedModelResponseSchema.parse(mainStoryWriteJson);
	const announcementsRecord = RecordedModelResponseSchema.parse(announcementsWriteJson);
	const prompts = [
		buildMainStoryCopyeditPrompt(parseMainStoryWriterOutput(mainRecord.text)),
		buildAnnouncementsCopyeditPrompt(attachAnnouncementIds(parseAnnouncementsWriterOutput(announcementsRecord.text))),
	];

	for (const prompt of prompts) {
		expect(prompt).not.toContain("[UNTRUSTED CHAT MESSAGE DATA]");
		expect(prompt).not.toContain("Messages analyzed:");
	}
});
