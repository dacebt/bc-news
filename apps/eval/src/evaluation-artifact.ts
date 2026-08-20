export { evaluationOutputContractProvenance } from "./evaluation-output-contract-provenance";
import { z } from "zod";
import { V7BenchmarkRunSchema } from "./evaluation-artifact-v7";
import { V8BenchmarkRunSchema } from "./evaluation-artifact-v8";
import { V9BenchmarkRunSchema } from "./evaluation-artifact-v9";

export const BenchmarkRunSchema = z.discriminatedUnion("version", [
	V7BenchmarkRunSchema,
	V8BenchmarkRunSchema,
	V9BenchmarkRunSchema,
]);
export type BenchmarkRun = z.infer<typeof BenchmarkRunSchema>;
export {
	CapturedRuntimeEvidenceSchema,
	PendingRuntimeEvidenceSchema,
	RuntimeEvidenceRecordSchema,
	UnavailableRuntimeEvidenceSchema,
	V7BenchmarkRunSchema,
	type RuntimeEvidenceRecord,
	type V7BenchmarkRun,
	type V7EvaluationTrial,
} from "./evaluation-artifact-v7";
export {
	GatewayRequestRecordSchema,
	V8BenchmarkRunSchema,
	V8EvalConfigSchema,
	V8ModelAdapterConfigSchema,
	type GatewayRequestRecord,
	type V8BenchmarkRun,
	type V8EvaluationTrial,
} from "./evaluation-artifact-v8";
export {
	GatewayRequestRecordSchema as V9GatewayRequestRecordSchema,
	RuntimeEvidenceRecordSchema as V9RuntimeEvidenceRecordSchema,
	V9BenchmarkRunSchema,
	deriveCurrentTrialOutcome,
	type V9BenchmarkRun,
	type V9EvaluationTrial,
} from "./evaluation-artifact-v9";
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
export { CurrentProductionModelStepSchema } from "./current-production-steps";
