import type { WorkflowStep } from "cloudflare:workers";
import type { GenerationRunParams } from "@bc-news/contracts";
import {
	EditorialOutputContractError,
	WRITER_SYSTEM_CONSTRAINTS,
	modelUsageRecord,
	type ModelCompletion,
	type ModelProviderPort,
	type ModelUsageRecord,
	type PreparedEvidence,
} from "@bc-news/generation-core";
import { generationRunAttemptInvocationId, generationRunInstanceId } from "./generation-run-instance-id";
import type { CurrentModelAttemptOutcome, CurrentModelAttemptRecord } from "./generation-run-model-attempt";
import {
	recordGenerationRunProgress,
	type CurrentEditorialDiagnostic,
	type GenerationStep,
} from "./generation-run-status";

type WriterStep = Extract<GenerationStep, "main_story_write" | "announcements_write">;
type WriterNextStep = Extract<GenerationStep, "announcements_write" | "validate-edition">;
type WriterStatusStepName =
	| "record-main-story-write-status"
	| "record-announcements-write-status";

type WriterDiagnostic = readonly {
	readonly kind: string;
	readonly production_step: string;
	readonly code: string;
	readonly message: string;
}[];

export const GENERATION_RUN_BOUNDED_RETRIES = {
	retries: { limit: 2, delay: "1 second", backoff: "exponential" },
} as const;

const GENERATION_RUN_MODEL_STEP_CONFIG = {
	...GENERATION_RUN_BOUNDED_RETRIES,
	timeout: "11 minutes",
} as const;

export interface GenerationRunWriterState {
	completedSteps: GenerationStep[];
	modelUsage: ModelUsageRecord[];
	modelAttempts: CurrentModelAttemptRecord[];
	diagnostics: CurrentEditorialDiagnostic[];
}

interface WriterDefinition<TProduct> {
	productionStep: WriterStep;
	modelProvider: ModelProviderPort;
	buildPrompt: (preparedEvidence: PreparedEvidence) => string;
	parseOutput: (text: string | null, preparedEvidence: PreparedEvidence) => TProduct;
	buildDiagnostics: (product: TProduct, preparedEvidence: PreparedEvidence) => WriterDiagnostic;
	preparedEvidence: PreparedEvidence;
	nextStep: WriterNextStep;
	recordStatusStepName: WriterStatusStepName;
}

interface RunGenerationWriterParams<TProduct> {
	db: D1Database;
	params: GenerationRunParams;
	step: WorkflowStep;
	state: GenerationRunWriterState;
	mechanicalRetryEnabled: boolean;
	definition: WriterDefinition<TProduct>;
}

function diagnosticsForWriterStep(
	diagnostics: WriterDiagnostic,
	productionStep: WriterStep,
): CurrentEditorialDiagnostic[] {
	return diagnostics.map((diagnostic) => ({
		...diagnostic,
		production_step: productionStep,
	})) as CurrentEditorialDiagnostic[];
}

function modelAttemptRecord(
	params: GenerationRunParams,
	productionStep: WriterStep,
	attempt: 1 | 2,
	outcome: CurrentModelAttemptOutcome,
	completion: ModelUsageRecord & { request_provenance?: ModelUsageRecord["request_provenance"] },
): CurrentModelAttemptRecord {
	return {
		production_step: productionStep,
		attempt,
		invocation_id: generationRunAttemptInvocationId(params, productionStep, attempt),
		outcome,
		model_usage: completion,
	};
}

async function recordWriterProgress(params: {
	db: D1Database;
	runParams: GenerationRunParams;
	step: WorkflowStep;
	statusStepName: string;
	currentStep: WriterStep | WriterNextStep;
	state: GenerationRunWriterState;
}): Promise<void> {
	await params.step.do(params.statusStepName, GENERATION_RUN_BOUNDED_RETRIES, () =>
		recordGenerationRunProgress(
			params.db,
			params.runParams,
			{
				currentStep: params.currentStep,
				completedSteps: params.state.completedSteps,
				modelUsage: params.state.modelUsage,
				modelAttempts: params.state.modelAttempts,
				diagnostics: params.state.diagnostics,
			},
			new Date().toISOString(),
		),
	);
}

async function persistRejectedAttempt(params: {
	db: D1Database;
	runParams: GenerationRunParams;
	step: WorkflowStep;
	state: GenerationRunWriterState;
	productionStep: WriterStep;
	attempt: 1 | 2;
	record: CurrentModelAttemptRecord;
}): Promise<void> {
	params.state.modelAttempts = [...params.state.modelAttempts, params.record];
	await recordWriterProgress({
		db: params.db,
		runParams: params.runParams,
		step: params.step,
		statusStepName:
			params.attempt === 1
				? `record-${params.productionStep}-rejection`
				: `record-${params.productionStep}-retry-rejection`,
		currentStep: params.productionStep,
		state: params.state,
	});
}

export async function runGenerationWriter<TProduct>(
	params: RunGenerationWriterParams<TProduct>,
): Promise<TProduct> {
	const attempts = params.mechanicalRetryEnabled ? ([1, 2] as const) : ([1] as const);
	const runId = generationRunInstanceId(params.params);

	for (const attempt of attempts) {
		const { definition, step, state } = params;
		const completionStepName =
			attempt === 1 ? definition.productionStep : `${definition.productionStep}-retry`;
		const completion = await step.do<ModelCompletion>(
			completionStepName,
			GENERATION_RUN_MODEL_STEP_CONFIG,
			() =>
				definition.modelProvider.complete({
					productionStep: definition.productionStep,
					system: WRITER_SYSTEM_CONSTRAINTS,
					user: definition.buildPrompt(definition.preparedEvidence),
					correlation: {
						run_id: runId,
						invocation_id: generationRunAttemptInvocationId(
							params.params,
							definition.productionStep,
							attempt,
						),
					},
				}),
		);
		const usage = modelUsageRecord(definition.productionStep, completion);

		try {
			const product = definition.parseOutput(completion.text, definition.preparedEvidence);
			if (params.mechanicalRetryEnabled) {
				state.modelAttempts = [
					...state.modelAttempts,
					modelAttemptRecord(
						params.params,
						definition.productionStep,
						attempt,
						{ status: "accepted" },
						usage,
					),
				];
			}
			state.completedSteps = [...state.completedSteps, definition.productionStep];
			state.modelUsage = [...state.modelUsage, usage];
			state.diagnostics = [
				...state.diagnostics,
				...diagnosticsForWriterStep(
					definition.buildDiagnostics(product, definition.preparedEvidence),
					definition.productionStep,
				),
			];
			await recordWriterProgress({
				db: params.db,
				runParams: params.params,
				step,
				statusStepName: definition.recordStatusStepName,
				currentStep: definition.nextStep,
				state,
			});
			return product;
		} catch (error) {
			if (
				error instanceof EditorialOutputContractError &&
				error.productionStep === definition.productionStep
			) {
				if (params.mechanicalRetryEnabled) {
					await persistRejectedAttempt({
						db: params.db,
						runParams: params.params,
						step,
						state,
						productionStep: definition.productionStep,
						attempt,
						record: modelAttemptRecord(
							params.params,
							definition.productionStep,
							attempt,
							{
								status: "rejected",
								code: error.code,
								message: error.message,
							},
							usage,
						),
					});
				}
				if (params.mechanicalRetryEnabled && attempt === 1) continue;
			}
			throw error;
		}
	}

	throw new Error("writer attempt loop exhausted without a result");
}
