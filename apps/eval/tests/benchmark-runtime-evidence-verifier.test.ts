import { test } from "vitest";
import { verifyBenchmarkRuntimeEvidence } from "../src/benchmark-runtime-evidence-verifier";
import { temporaryRoot } from "./evaluation-artifact-test-support";

test("verifies the strict V7 runtime evidence command, store, reader, and summary path", async () => {
	await verifyBenchmarkRuntimeEvidence(await temporaryRoot("bc-news-runtime-evidence-verifier-test-"));
});
