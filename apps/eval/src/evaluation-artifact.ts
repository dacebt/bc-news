export {
	evaluationOutputContractProvenance,
	V1BenchmarkRunSchema,
	type V1BenchmarkRun,
} from "./evaluation-artifact-benchmark";
import { z } from "zod";
import { V1BenchmarkRunSchema } from "./evaluation-artifact-benchmark";
import { V2BenchmarkRunSchema } from "./evaluation-artifact-v2";
import { V3BenchmarkRunSchema } from "./evaluation-artifact-v3";
import { V4BenchmarkRunSchema } from "./evaluation-artifact-v4";
import { V5BenchmarkRunSchema } from "./evaluation-artifact-v5";

export const BenchmarkRunSchema = z.discriminatedUnion("version", [
	V1BenchmarkRunSchema,
	V2BenchmarkRunSchema,
	V3BenchmarkRunSchema,
	V4BenchmarkRunSchema,
	V5BenchmarkRunSchema,
]);
export type BenchmarkRun = z.infer<typeof BenchmarkRunSchema>;
export { V2BenchmarkRunSchema, type V2BenchmarkRun } from "./evaluation-artifact-v2";
export { V3BenchmarkRunSchema, type V3BenchmarkRun } from "./evaluation-artifact-v3";
export { V4BenchmarkRunSchema, type V4BenchmarkRun } from "./evaluation-artifact-v4";
export { V5BenchmarkRunSchema, type V5BenchmarkRun, type V5EvaluationTrial, type V5SubjectOutcome } from "./evaluation-artifact-v5";
export { deriveEvaluationTrialOutcome } from "./evaluation-artifact-outcomes";
export {
	EvaluationCodeProvenanceSchema,
	EvaluationFindingSchema,
	EvaluationTrialSchema,
	StepInvocationSchema,
	SubjectOutcomeSchema,
	evaluationConfigIdentity,
	type EvaluationFinding,
	type EvaluationTrial,
	type StepInvocation,
	type SubjectOutcome,
} from "./evaluation-artifact-schemas";
