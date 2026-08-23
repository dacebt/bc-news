import { modelRequestSha256 } from "@bc-news/fixtures";
import {
	WRITER_SYSTEM_CONSTRAINTS,
	announcementsFinalProductDiagnostics,
	buildAnnouncementsWriterPrompt,
	buildMainStoryWriterPrompt,
	mainStoryFinalProductDiagnostics,
	modelUsageRecord,
	parseAnnouncementsWriterOutput,
	parseMainStoryWriterOutput,
	type AnnouncementsProduct,
	type EditorialDiagnostic,
	type MainStoryProduct,
	type ModelCompletion,
	type ModelProviderPort,
	type ModelProviderRequest,
	type ModelRequestCorrelation,
	type ModelUsageRecord,
	type PreparedEvidence,
} from "@bc-news/generation-core";
import {
	CURRENT_PRODUCTION_MODEL_STEPS,
	type CurrentProductionModelStep,
} from "./current-production-steps";

export interface EvalStep {
	readonly production_step: CurrentProductionModelStep;
	readonly prompt_sha256: string;
	readonly output: Record<string, unknown>;
	readonly model_usage: ModelUsageRecord;
}

export interface EvalProducts {
	readonly mainStory: MainStoryProduct;
	readonly announcements: AnnouncementsProduct;
}

export interface ProductionStepObservation {
	readonly request: ModelProviderRequest;
	readonly completion: ModelCompletion;
}

export interface ProductionStepsExecution {
	readonly steps: readonly EvalStep[];
	readonly products: EvalProducts;
	readonly diagnostics: readonly EditorialDiagnostic[];
	readonly observations: readonly ProductionStepObservation[];
}

export interface ProductionStepsExecutionOptions {
	readonly correlationRunId?: string;
}

async function completeStep(input: {
	readonly productionStep: CurrentProductionModelStep;
	readonly provider: ModelProviderPort;
	readonly system: string;
	readonly user: string;
	readonly correlation?: ModelRequestCorrelation;
}): Promise<{
	readonly request: ModelProviderRequest;
	readonly completion: ModelCompletion;
	readonly step: EvalStep;
}> {
	const request: ModelProviderRequest = {
		productionStep: input.productionStep,
		system: input.system,
		user: input.user,
		...(input.correlation === undefined
			? {}
			: { correlation: input.correlation }),
	};
	const completion = await input.provider.complete(request);
	return {
		request,
		completion,
		step: {
			production_step: input.productionStep,
			prompt_sha256: await modelRequestSha256(request),
			output: {},
			model_usage: modelUsageRecord(input.productionStep, completion),
		},
	};
}

export async function executeProductionSteps(
	preparedEvidence: PreparedEvidence,
	providers: Readonly<Record<CurrentProductionModelStep, ModelProviderPort>>,
	options: ProductionStepsExecutionOptions = {},
): Promise<ProductionStepsExecution> {
	const correlation = (
		ordinal: number,
	): { readonly correlation?: ModelRequestCorrelation } =>
		options.correlationRunId === undefined
			? {}
			: {
					correlation: {
						run_id: options.correlationRunId,
						invocation_id: `${options.correlationRunId}-invocation-${String(ordinal)}`,
					},
			  };

	const mainStoryWriter = await completeStep({
		productionStep: "main_story_write",
		provider: providers.main_story_write,
		system: WRITER_SYSTEM_CONSTRAINTS,
		user: buildMainStoryWriterPrompt(preparedEvidence),
		...correlation(1),
	});
	const mainStory = parseMainStoryWriterOutput(
		mainStoryWriter.completion.text,
		preparedEvidence,
	);

	const announcementsWriter = await completeStep({
		productionStep: "announcements_write",
		provider: providers.announcements_write,
		system: WRITER_SYSTEM_CONSTRAINTS,
		user: buildAnnouncementsWriterPrompt(preparedEvidence),
		...correlation(2),
	});
	const announcements = parseAnnouncementsWriterOutput(
		announcementsWriter.completion.text,
		preparedEvidence,
	);

	const diagnostics = [
		...mainStoryFinalProductDiagnostics(mainStory, preparedEvidence),
		...announcementsFinalProductDiagnostics(announcements, preparedEvidence),
	];
	const outputs: Readonly<
		Record<CurrentProductionModelStep, Record<string, unknown>>
	> = {
		main_story_write: mainStory,
		announcements_write: announcements,
	};
	const completedSteps = [mainStoryWriter, announcementsWriter];

	return {
		steps: CURRENT_PRODUCTION_MODEL_STEPS.map((productionStep, index) => ({
			...completedSteps[index]!.step,
			output: outputs[productionStep],
		})),
		products: { mainStory, announcements },
		diagnostics,
		observations: completedSteps.map(({ request, completion }) => ({
			request,
			completion,
		})),
	};
}
