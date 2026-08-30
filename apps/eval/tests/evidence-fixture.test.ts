import { expect, test } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFixture } from "../src/evidence-fixture";
import {
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

test("explicit fixture paths can load the dedicated game-reference corpus", async () => {
	const loaded = await loadFixture(RECORDED_OUTPUT_FIXTURE_PATH);

	expect(loaded.path).toBe(RECORDED_OUTPUT_FIXTURE_PATH);
	expect(loaded.fixture.active_region_id).toBe("19");
	expect(loaded.fixture.evidence_date).toBe("2026-08-15");
	expect(loaded.publicationDate).toBe("2026-08-16");
	expect(loaded.fixture.messages.find((message) => message.id === "synthetic-game-reference-links-001"))
		.toEqual(expect.objectContaining({ text: "(coord=7968,9659)" }));
});

test("representative and dedicated fixtures remain distinct files", () => {
	expect(RECORDED_OUTPUT_FIXTURE_PATH).not.toBe(REPRESENTATIVE_FIXTURE_PATH);
	expect(join(RECORDED_OUTPUT_FIXTURE_PATH)).toContain("game-reference-links.json");
});
