import { expect, test } from "vitest";
import {
	EvaluationLongitudinalDeclarationSchema,
	EvaluationLongitudinalDeclarationV1Schema,
	EvaluationLongitudinalDeclarationV3Schema,
	EvaluationLongitudinalScorecardArtifactSchema,
	EvaluationLongitudinalScorecardArtifactV1Schema,
	EvaluationLongitudinalScorecardArtifactV3Schema,
	LocalSourceReferenceSchema,
	StableLongitudinalContextV1Schema,
	StableLongitudinalContextV3Schema,
} from "../src/evaluation-longitudinal-scorecard";
import {
	EvaluationLongitudinalDeclarationV2Schema,
	EvaluationLongitudinalScorecardArtifactV2Schema,
} from "../src/evaluation-longitudinal-scorecard-v2";

const reference = (path: string, sha256 = "a".repeat(64)) => ({ path, sha256 });
const repositoryReference = (path: string, commit = "a".repeat(40)) => ({ repository: "bc-news" as const, commit_sha: commit, path });

test("accepts an ordered baseline and subject roster of local-data references", () => {
	const declaration = { version: 4, id: "series-input", scorecards: [
		{ ordinal: 1, phase: "baseline", scorecard_id: "scorecard-one", source_reference: reference("scorecards/one.json") },
		{ ordinal: 2, phase: "subject", scorecard_id: "scorecard-two", source_reference: reference("scorecards/two.json", "b".repeat(64)) },
	] };
	expect(LocalSourceReferenceSchema.safeParse(declaration.scorecards[0]!.source_reference).success).toBe(true);
	expect(EvaluationLongitudinalDeclarationSchema.safeParse(declaration).success).toBe(true);
	expect(EvaluationLongitudinalDeclarationSchema.safeParse({ ...declaration, scorecards: declaration.scorecards.map((item) => ({ ...item, phase: "baseline" })) }).success).toBe(false);
	expect(EvaluationLongitudinalDeclarationSchema.safeParse({ ...declaration, scorecards: [declaration.scorecards[0], { ...declaration.scorecards[1], source_reference: declaration.scorecards[0]!.source_reference }] }).success).toBe(false);
	expect(LocalSourceReferenceSchema.safeParse(reference("../escape.json")).success).toBe(false);
});

test("rejects recursive byte ownership at the current artifact boundary", () => {
	expect(EvaluationLongitudinalScorecardArtifactSchema.safeParse({ version: 4, id: "series-one", source_payloads: {}, declaration_sha256: "1".repeat(64) }).success).toBe(false);
});

test("keeps the historical longitudinal v1, v2, and v3 contracts explicit", () => {
	const declarationV1 = { version: 1, id: "series-input-v1", scorecards: [
		{ ordinal: 1, phase: "baseline", path: "scorecards/one.json", scorecard_id: "scorecard-one", scorecard_sha256: "1".repeat(64) },
		{ ordinal: 2, phase: "subject", path: "scorecards/two.json", scorecard_id: "scorecard-two", scorecard_sha256: "2".repeat(64) },
	] };
	const declarationV2 = { version: 2, id: "series-input-v2", scorecards: [
		{ ordinal: 1, phase: "baseline", scorecard_id: "scorecard-one", source_reference: repositoryReference("scorecards/one.json") },
		{ ordinal: 2, phase: "subject", scorecard_id: "scorecard-two", source_reference: repositoryReference("scorecards/two.json", "b".repeat(40)) },
	] };
	const declarationV3 = { version: 3, id: "series-input-v3", scorecards: [
		{ ordinal: 1, phase: "baseline", scorecard_id: "scorecard-one", source_reference: reference("local/one.json") },
		{ ordinal: 2, phase: "subject", scorecard_id: "scorecard-two", source_reference: reference("local/two.json", "b".repeat(64)) },
	] };
	expect(EvaluationLongitudinalDeclarationV1Schema.safeParse(declarationV1).success).toBe(true);
	expect(EvaluationLongitudinalDeclarationV2Schema.safeParse(declarationV2).success).toBe(true);
	expect(EvaluationLongitudinalDeclarationV3Schema.safeParse(declarationV3).success).toBe(true);
	expect(StableLongitudinalContextV1Schema.safeParse({ state: "unknown", reason: "no_captured_invocation" }).success).toBe(true);
	expect(StableLongitudinalContextV3Schema.safeParse({ state: "unknown", reason: "no_captured_invocation" }).success).toBe(true);
	expect(EvaluationLongitudinalScorecardArtifactV1Schema.safeParse({ version: 2, id: "series-one", source_payloads: {} }).success).toBe(false);
	expect(EvaluationLongitudinalScorecardArtifactV2Schema.safeParse({ version: 3, id: "series-two", source_reference: reference("local/declaration.json") }).success).toBe(false);
	expect(EvaluationLongitudinalScorecardArtifactV3Schema.safeParse({ version: 4, id: "series-three", source_reference: reference("local/declaration.json") }).success).toBe(false);
});
