export {
	evaluationOutputContractProvenance,
	V1BenchmarkRunSchema,
	type V1BenchmarkRun,
} from "./evaluation-artifact-benchmark";
import { z } from "zod";
import { V1BenchmarkRunSchema } from "./evaluation-artifact-benchmark";
import { V2BenchmarkRunSchema } from "./evaluation-artifact-v2";

export const BenchmarkRunSchema = z.discriminatedUnion("version", [V1BenchmarkRunSchema, V2BenchmarkRunSchema]);
export type BenchmarkRun = z.infer<typeof BenchmarkRunSchema>;
export { V2BenchmarkRunSchema, type V2BenchmarkRun } from "./evaluation-artifact-v2";
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
