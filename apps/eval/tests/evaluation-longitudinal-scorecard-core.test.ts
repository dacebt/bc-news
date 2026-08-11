import { expect, test } from "vitest";
import {
	EvaluationLongitudinalDeclarationSchema,
	EvaluationLongitudinalDeclarationV1Schema,
	EvaluationLongitudinalScorecardArtifactSchema,
	EvaluationLongitudinalScorecardArtifactV1Schema,
	StableLongitudinalContextV1Schema,
} from "../src/evaluation-longitudinal-scorecard";

const reference = (path: string, commit = "a".repeat(40)) => ({ repository: "bc-news" as const, commit_sha: commit, path });

test("accepts an ordered baseline and subject roster of commit references", () => {
	const declaration = { version: 2, id: "series-input", scorecards: [
		{ ordinal: 1, phase: "baseline", scorecard_id: "scorecard-one", source_reference: reference("scorecards/one.json") },
		{ ordinal: 2, phase: "subject", scorecard_id: "scorecard-two", source_reference: reference("scorecards/two.json") },
	] };
	expect(EvaluationLongitudinalDeclarationSchema.safeParse(declaration).success).toBe(true);
	expect(EvaluationLongitudinalDeclarationSchema.safeParse({ ...declaration, scorecards: declaration.scorecards.map((item) => ({ ...item, phase: "baseline" })) }).success).toBe(false);
	expect(EvaluationLongitudinalDeclarationSchema.safeParse({ ...declaration, scorecards: [declaration.scorecards[0], { ...declaration.scorecards[1], source_reference: declaration.scorecards[0]!.source_reference }] }).success).toBe(false);
});

test("rejects recursive byte ownership at the current artifact boundary", () => {
	expect(EvaluationLongitudinalScorecardArtifactSchema.safeParse({ version: 2, id: "series-one", source_payloads: {}, declaration_sha256: "1".repeat(64) }).success).toBe(false);
});

test("keeps the historical longitudinal declaration, context, and artifact contracts explicit", () => {
	const declaration = { version: 1, id: "series-input-v1", scorecards: [
		{ ordinal: 1, phase: "baseline", path: "scorecards/one.json", scorecard_id: "scorecard-one", scorecard_sha256: "1".repeat(64) },
		{ ordinal: 2, phase: "subject", path: "scorecards/two.json", scorecard_id: "scorecard-two", scorecard_sha256: "2".repeat(64) },
	] };
	expect(EvaluationLongitudinalDeclarationV1Schema.safeParse(declaration).success).toBe(true);
	expect(StableLongitudinalContextV1Schema.safeParse({ state: "unknown", reason: "no_captured_invocation" }).success).toBe(true);
	expect(EvaluationLongitudinalScorecardArtifactV1Schema.safeParse({ version: 2, id: "series-one", source_payloads: {} }).success).toBe(false);
});
