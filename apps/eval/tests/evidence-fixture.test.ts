import { expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFixture } from "../src/evidence-fixture";
import {
	LOCAL_MODEL_ENTITY_FIXTURE_PATH,
	RECORDED_OUTPUT_FIXTURE_PATH,
	REPRESENTATIVE_FIXTURE_PATH,
} from "../src/representative-fixture";

const APP_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_PACKAGE_PATH = join(APP_DIRECTORY, "..", "..", "packages", "fixtures");

test("package-root fixture loading stays pinned to the historical representative fixture", async () => {
	const loaded = await loadFixture(FIXTURE_PACKAGE_PATH);

	expect(loaded.path).toBe(FIXTURE_PACKAGE_PATH);
	expect(loaded.fixture.active_region_id).toBe("7");
	expect(loaded.fixture.evidence_date).toBe("2026-01-24");
	expect(loaded.publicationDate).toBe("2026-01-25");
});

test("explicit fixture paths can load the selected local-model entity corpus", async () => {
	const loaded = await loadFixture(RECORDED_OUTPUT_FIXTURE_PATH);

	expect(loaded.path).toBe(RECORDED_OUTPUT_FIXTURE_PATH);
	expect(loaded.fixture.active_region_id).toBe("9");
	expect(loaded.fixture.evidence_date).toBe("2026-08-16");
	expect(loaded.publicationDate).toBe("2026-08-17");
	expect(loaded.fixture.messages.find((message) => message.id === "648518348451327843"))
		.toEqual(expect.objectContaining({ text: "(item=163977632)(item=264387410)(item=1122421091)" }));
});

test("representative and selected local-model fixtures remain distinct files", () => {
	expect(RECORDED_OUTPUT_FIXTURE_PATH).not.toBe(REPRESENTATIVE_FIXTURE_PATH);
	expect(RECORDED_OUTPUT_FIXTURE_PATH).toBe(LOCAL_MODEL_ENTITY_FIXTURE_PATH);
	expect(join(RECORDED_OUTPUT_FIXTURE_PATH)).toContain("entity-reference-links.json");
});
