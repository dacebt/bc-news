import assert from "node:assert/strict";
import test from "node:test";
import {
	assertPublishedGameReferences,
	EXPECTED_GAME_REFERENCES,
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
