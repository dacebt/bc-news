import { expect, test } from "vitest";
import { loadFixture } from "../src/evidence-fixture";
import {
	prepareFixtureEvidenceWithGameReferenceResolutions,
	prepareFixtureEvidenceWithGameReferences,
} from "../src/fixture-prepared-evidence";
import { RECORDED_OUTPUT_FIXTURE_PATH } from "../src/representative-fixture";

async function entityFixtureInput() {
	const loaded = await loadFixture(RECORDED_OUTPUT_FIXTURE_PATH);
	return {
		fixture: loaded.fixture,
		publicationDate: loaded.publicationDate,
		input: {
			activeRegionId: loaded.fixture.active_region_id,
			publicationDate: loaded.publicationDate,
			messages: loaded.fixture.messages,
		},
	};
}

test("the sync and async fixture prepared-evidence helpers remain exactly equal for entity fixtures", async () => {
	const { input } = await entityFixtureInput();
	const syncPrepared = prepareFixtureEvidenceWithGameReferenceResolutions(input);
	await expect(prepareFixtureEvidenceWithGameReferences(input)).resolves.toEqual(syncPrepared);
	expect(syncPrepared.game_references).toEqual([{
		token: "[[GAME_REF_001]]",
		kind: "item",
		id: "163977632",
		display_text: "Ornate Leather Shirt",
		destination_url: "https://bitjita.com/items/163977632",
	}]);
});
