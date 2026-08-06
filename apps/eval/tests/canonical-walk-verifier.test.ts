import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { PRODUCTION_MODEL_STEPS } from "@bc-news/generation-core";
import { assertCanonicalEvalGrounding } from "../src/canonical-eval-grounding";
import { assertCanonicalEvalSemantics } from "../src/canonical-eval-semantics";
import { CANONICAL_CONFIG_PATH, CANONICAL_FIXTURE_PATH } from "../src/canonical-walk-verifier";
import { compareRuns } from "../src/compare";
import { runCommand } from "../src/run-command";
import { allDifferences } from "../src/run-difference";

test("canonical replay retains the four outputs and recomputed request relations", async () => {
	const { run } = await runCommand({
		fixturePath: CANONICAL_FIXTURE_PATH,
		configPath: CANONICAL_CONFIG_PATH,
		resultsDirectory: await mkdtemp(join(tmpdir(), "bc-news-canonical-")),
		environment: {},
	});

	expect(run.steps.map((step) => step.production_step)).toEqual(PRODUCTION_MODEL_STEPS);
	expect(() => assertCanonicalEvalSemantics(run)).not.toThrow();
	await expect(assertCanonicalEvalGrounding(run, CANONICAL_FIXTURE_PATH)).resolves.toBeUndefined();
});

test("difference reporting names every changed product path", () => {
	expect(allDifferences(
		{ title: "A", story: { lede: "B", body: "C" } },
		{ title: "X", story: { lede: "Y", body: "C" } },
	)).toEqual(["run.story.lede", "run.title"]);
});

test("human comparison ignores edition generation wall-clock time", () => {
	const left = {
		id: "left",
		steps: [],
		edition: { meta: { generated_at_utc: "2026-08-05T10:00:00.000Z" } },
	};
	const right = {
		id: "right",
		steps: [],
		edition: { meta: { generated_at_utc: "2026-08-05T10:00:01.000Z" } },
	};

	expect(compareRuns(left, right).differences).toEqual([]);
});
