import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EvidenceFixtureSchema } from "@bc-news/contracts";
import {
	DuplicateEvidenceIdError,
	buildAnnouncementsPrompt,
	buildMainStoryPrompt,
	buildPackagingPrompt,
	parseAnnouncementsOutput,
	parseMainStoryOutput,
	parsePackagingOutput,
	prepareEvidence,
} from "@bc-news/generation-core";
import { RecordedModelResponseSchema } from "@bc-news/fixtures";

const ACTIVE_REGION_ID = "7";
const EVIDENCE_DATE = "2026-01-24";
const PUBLICATION_DATE = "2026-01-25";
const PROBE = {
	id: "504403158437419536",
	ts: 1769285267000,
	author_id: "en/Aryn",
	author_name: null,
	text: "k",
} as const;
const PREPARED_EVIDENCE_SHA256 = "3259e64fcf7b60b3bac4e24c8817f5edb85052cdd9ff712528f88c8ab2dace27";

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function sha256(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

function readJson(path: string): unknown {
	return JSON.parse(readFileSync(path, "utf8"));
}

const fixturesDirectory = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = EvidenceFixtureSchema.parse(
	readJson(join(fixturesDirectory, "evidence", `active-region-${ACTIVE_REGION_ID}_${EVIDENCE_DATE}.json`)),
);
assert(fixture.active_region_id === ACTIVE_REGION_ID, "Canonical fixture active region changed");
assert(fixture.evidence_date === EVIDENCE_DATE, "Canonical fixture evidence date changed");
assert(fixture.messages.length === 630, `Expected 630 canonical rows; found ${fixture.messages.length}`);

const nullAuthors = fixture.messages.filter((message) => message.author_name === null);
assert(nullAuthors.length === 1, `Expected exactly one null author; found ${nullAuthors.length}`);
assert(JSON.stringify(nullAuthors[0]) === JSON.stringify(PROBE), "Nullable-author probe contract changed");

const preparedEvidence = prepareEvidence({
	activeRegionId: ACTIVE_REGION_ID,
	publicationDate: PUBLICATION_DATE,
	messages: fixture.messages,
});
assert(preparedEvidence.raw_count === 630, `Expected raw count 630; found ${preparedEvidence.raw_count}`);
assert(preparedEvidence.after_filter_count === 623, `Expected after-filter count 623; found ${preparedEvidence.after_filter_count}`);
assert(preparedEvidence.after_burst_count === 553, `Expected after-burst count 553; found ${preparedEvidence.after_burst_count}`);
assert(preparedEvidence.final_count === 208, `Expected final count 208; found ${preparedEvidence.final_count}`);
assert(preparedEvidence.drop_stats.empty_after_trim === 0, "Expected zero empty-after-trim drops");
assert(preparedEvidence.drop_stats.too_short === 7, "Expected seven too-short drops");
assert(preparedEvidence.drop_stats.burst_merged === 70, "Expected seventy burst-merged drops");
assert(preparedEvidence.drop_stats.sampling_dropped === 345, "Expected 345 sampling drops");
assert(!preparedEvidence.messages.some((message) => message.id === PROBE.id), "Nullable-author probe survived the too-short filter");
assert(sha256(JSON.stringify(preparedEvidence)) === PREPARED_EVIDENCE_SHA256, "Prepared evidence bytes changed");

try {
	prepareEvidence({
		activeRegionId: ACTIVE_REGION_ID,
		publicationDate: PUBLICATION_DATE,
		messages: [...fixture.messages, PROBE],
	});
	throw new Error("Duplicate nullable-author probe did not reject");
} catch (error) {
	assert(error instanceof DuplicateEvidenceIdError, "Duplicate nullable-author probe did not raise DuplicateEvidenceIdError");
	assert(error.id === PROBE.id, `Duplicate rejection named unexpected id ${error.id}`);
}

function responseRecord(capability: "announcements" | "main_story" | "packaging") {
	return RecordedModelResponseSchema.parse(
		readJson(join(fixturesDirectory, "model-responses", `${capability}.json`)),
	);
}

const mainStoryRecord = responseRecord("main_story");
const announcementsRecord = responseRecord("announcements");
const packagingRecord = responseRecord("packaging");
assert(mainStoryRecord.editorial_capability === "main_story", "Main-story response capability changed");
assert(announcementsRecord.editorial_capability === "announcements", "Announcements response capability changed");
assert(packagingRecord.editorial_capability === "packaging", "Packaging response capability changed");
assert(sha256(buildMainStoryPrompt(preparedEvidence)) === mainStoryRecord.prompt_sha256, "Main-story user-prompt hash changed");
assert(sha256(buildAnnouncementsPrompt(preparedEvidence)) === announcementsRecord.prompt_sha256, "Announcements user-prompt hash changed");

const mainStory = parseMainStoryOutput(mainStoryRecord.text);
const announcements = parseAnnouncementsOutput(announcementsRecord.text);
const packagingPrompt = buildPackagingPrompt(mainStory, announcements, {
	activeRegionId: ACTIVE_REGION_ID,
	publicationDate: PUBLICATION_DATE,
});
assert(sha256(packagingPrompt) === packagingRecord.prompt_sha256, "Packaging user-prompt hash changed");
parsePackagingOutput(packagingRecord.text);

console.log("EVIDENCE INTEGRITY VERIFY PASS");
