import { expect, test } from "vitest";
import { collectRunFingerprint } from "../src/fingerprint";

test("produces the same content fields for identical fixture bytes", async () => {
	const bytes = new TextEncoder().encode('{"active_region_id":"7"}');
	const first = await collectRunFingerprint(bytes);
	const second = await collectRunFingerprint(bytes);
	expect(second).toEqual(first);
});

test("changes fixture_sha256 when fixture bytes differ", async () => {
	const left = await collectRunFingerprint(new TextEncoder().encode("left"));
	const right = await collectRunFingerprint(new TextEncoder().encode("right"));
	expect(left.fixture_sha256).not.toBe(right.fixture_sha256);
	expect(left.checks_sha256).toBe(right.checks_sha256);
});

test("hashes the empty file list to a stable sha256 for rubrics_sha256", async () => {
	const bytes = new TextEncoder().encode("anything");
	const content = await collectRunFingerprint(bytes);
	// sha256 of the empty length-prefixed concatenation: no rubrics file exists this
	// slice, so the hash of zero files stands in, well-defined and reproducible.
	expect(content.rubrics_sha256).toBe(
		"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
	);
});
