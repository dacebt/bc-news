import { expect, test } from "vitest";
import { collectRunFingerprint } from "../src/fingerprint";

test("produces the same content fields for identical fixture bytes", async () => {
	const bytes = new TextEncoder().encode('{"active_region_id":"7"}');
	const first = await collectRunFingerprint(bytes, false);
	const second = await collectRunFingerprint(bytes, false);
	expect(second).toEqual(first);
});

test("changes fixture_sha256 when fixture bytes differ", async () => {
	const left = await collectRunFingerprint(new TextEncoder().encode("left"), false);
	const right = await collectRunFingerprint(new TextEncoder().encode("right"), false);
	expect(left.fixture_sha256).not.toBe(right.fixture_sha256);
	expect(left.checks_sha256).toBe(right.checks_sha256);
});

test("fingerprints judge inputs only when the run uses a judge", async () => {
	const bytes = new TextEncoder().encode("anything");
	const withoutJudge = await collectRunFingerprint(bytes, false);
	const withJudge = await collectRunFingerprint(bytes, true);
	expect(withoutJudge.rubrics_sha256).toBe(
		"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
	);
	expect(withJudge.rubrics_sha256).toMatch(/^[0-9a-f]{64}$/);
	expect(withJudge.rubrics_sha256).not.toBe(withoutJudge.rubrics_sha256);
	expect(withJudge.providers_sha256).not.toBe(withoutJudge.providers_sha256);
});
