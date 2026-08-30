import assert from "node:assert/strict";
import test from "node:test";
import { readRecordedResponse } from "../walk/recorded-response-reader";

void test("the walk reader accepts the committed strict v3 main-story response fixture", async () => {
	const response = await readRecordedResponse("main_story_write");

	assert.equal(response.production_step, "main_story_write");
	assert.match(response.prompt_sha256, /^[0-9a-f]{64}$/u);
});

void test("the walk reader accepts the committed strict v3 announcements response fixture", async () => {
	const response = await readRecordedResponse("announcements_write");

	assert.equal(response.production_step, "announcements_write");
	assert.match(response.prompt_sha256, /^[0-9a-f]{64}$/u);
});
