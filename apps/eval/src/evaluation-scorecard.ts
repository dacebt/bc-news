import type { EvaluationScorecardArtifact as EvaluationScorecardArtifactV2 } from "./evaluation-scorecard-v2";
import type { EvaluationScorecardArtifact as EvaluationScorecardArtifactV3 } from "./evaluation-scorecard-v3";
import type { EvaluationScorecardArtifact as CurrentEvaluationScorecardArtifact } from "./evaluation-scorecard-current";

export {
	EVALUATION_SCORECARD_ERROR_CODES,
	EvaluationScorecardError,
	EvaluationScorecardDeclarationV1Schema,
	EvaluationScorecardDeclarationSchema as EvaluationScorecardDeclarationV2Schema,
	OutputIdentityV1Schema,
	OutputIdentitySchema as OutputIdentityV2Schema,
	OutputSpanSchema,
	AnnotationBundleV1Schema,
	AnnotationBundleSchema as AnnotationBundleV2Schema,
	QualitativeReviewBundleV1Schema,
	QualitativeReviewBundleSchema as QualitativeReviewBundleV2Schema,
	EvaluationScorecardArtifactV1Schema,
	EvaluationScorecardArtifactSchema as EvaluationScorecardArtifactV2Schema,
} from "./evaluation-scorecard-v2";
export {
	AnnotationBundleSchema as AnnotationBundleV3Schema,
	EvaluationScorecardArtifactSchema as EvaluationScorecardArtifactV3Schema,
	EvaluationScorecardDeclarationSchema as EvaluationScorecardDeclarationV3Schema,
	OutputIdentitySchema as OutputIdentityV3Schema,
	QualitativeReviewBundleSchema as QualitativeReviewBundleV3Schema,
} from "./evaluation-scorecard-v3";
export {
	AnnotationBundleSchema,
	EvaluationScorecardArtifactSchema,
	EvaluationScorecardDeclarationSchema,
	OutputIdentitySchema,
	QualitativeReviewBundleSchema,
} from "./evaluation-scorecard-current";

export type {
	AnnotationBundle,
	EvaluationRoleScorecard,
	EvaluationScorecardArtifact,
	EvaluationScorecardDeclaration,
	OutputIdentity,
	QualitativeReviewBundle,
	ScorecardContext,
} from "./evaluation-scorecard-current";
export type {
	AnnotationBundle as AnnotationBundleV3,
	EvaluationScorecardArtifact as EvaluationScorecardArtifactV3,
	EvaluationScorecardDeclaration as EvaluationScorecardDeclarationV3,
	EvaluationRoleScorecard as EvaluationRoleScorecardV3,
	OutputIdentity as OutputIdentityV3,
	QualitativeReviewBundle as QualitativeReviewBundleV3,
	ScorecardContext as ScorecardContextV3,
} from "./evaluation-scorecard-v3";
export type {
	AnnotationBundle as AnnotationBundleV2,
	AnnotationBundleV1,
	EvaluationRoleScorecard as EvaluationRoleScorecardV2,
	EvaluationRoleScorecardV1,
	EvaluationScorecardArtifact as EvaluationScorecardArtifactV2,
	EvaluationScorecardArtifactV1,
	EvaluationScorecardDeclaration as EvaluationScorecardDeclarationV2,
	EvaluationScorecardDeclarationV1,
	OutputIdentity as OutputIdentityV2,
	OutputIdentityV1,
	QualitativeReviewBundle as QualitativeReviewBundleV2,
	QualitativeReviewBundleV1,
} from "./evaluation-scorecard-v2";

export type AnyEvaluationScorecardArtifact =
	| import("./evaluation-scorecard-v2").EvaluationScorecardArtifactV1
	| EvaluationScorecardArtifactV2
	| EvaluationScorecardArtifactV3
	| CurrentEvaluationScorecardArtifact;
