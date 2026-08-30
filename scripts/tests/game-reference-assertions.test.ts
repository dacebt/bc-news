import assert from "node:assert/strict";
import test from "node:test";
import {
	assertPublishedGameReferences,
	EXPECTED_GAME_REFERENCES,
	renderedMarkdownText,
} from "../walk/game-reference-assertions";

const EDITION = {
	game_references: EXPECTED_GAME_REFERENCES,
};

void test("accepts only the exact retained game-reference roster", () => {
	assert.doesNotThrow(() => assertPublishedGameReferences(EDITION));
	assert.throws(
		() => assertPublishedGameReferences({ game_references: EXPECTED_GAME_REFERENCES.slice(1) }),
		/unexpected game-reference roster/,
	);
	assert.throws(
		() => assertPublishedGameReferences({ title: "missing roster" }),
		/missing the exact game-reference roster/,
	);
});

void test("renders tokenized and ordinary markdown text the way the reader sees it", () => {
	assert.equal(
		renderedMarkdownText(
			"Late marker [[GAME_REF_001]] and bare pin [[GAME_REF_002]] plus [spoofed focused map](https://bitcraftmap.com/?center=1,1&zoom=99)",
			EDITION,
		),
		"Late marker Fire Nation and bare pin N 7968, E 9659 plus spoofed focused map",
	);
});
