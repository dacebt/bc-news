import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { GenerationRunParamsSchema, type GenerationRunParams } from "@bc-news/contracts";
import {
	SYSTEM_CONSTRAINTS,
	assembleEdition,
	buildAnnouncementsPrompt,
	buildMainStoryPrompt,
	buildPackagingPrompt,
	evidenceDateForPublicationDate,
	modelUsageRecord,
	parseAnnouncementsOutput,
	parseMainStoryOutput,
	parsePackagingOutput,
	prepareEvidence,
	type ModelUsageRecord,
	type PreparedEvidence,
} from "@bc-news/generation-core";
import { resolveGenerationPorts } from "./config";
import { publishEdition } from "./edition-store";
import {
	recordGenerationRunComplete,
	recordGenerationRunFailure,
	recordGenerationRunProgress,
	type GenerationRunFailure,
	type GenerationStep,
} from "./generation-run-status";
import { failNonRetryablyOnDeterministicErrors } from "./non-retryable";

export function generationRunInstanceId(params: GenerationRunParams): string {
	return `generation-run-${params.active_region_id}-${params.publication_date}`;
}

const BOUNDED_RETRIES = {
	retries: { limit: 2, delay: "1 second", backoff: "exponential" },
} as const;

const MODEL_STEP_CONFIG = {
	...BOUNDED_RETRIES,
	timeout: "11 minutes",
} as const;

const STEP_RESULT_BYTE_CAP = 1_048_576;

function assertWithinStepResultCap(preparedEvidence: PreparedEvidence): void {
	const bytes = new TextEncoder().encode(JSON.stringify(preparedEvidence)).byteLength;
	if (bytes > STEP_RESULT_BYTE_CAP) {
		throw new NonRetryableError(
			`prepare-evidence result is ${bytes} bytes, over the ${STEP_RESULT_BYTE_CAP}-byte step-result cap`,
			"prepared_evidence_over_step_result_cap",
		);
	}
}

function failureCode(error: unknown): string {
	if (error instanceof Error && error.name !== "Error") return error.name;
	if (
		error instanceof Error &&
		error.name === "Error" &&
		error.message.startsWith("no_evidence_for_publication_date: ")
	) {
		return "no_evidence_for_publication_date";
	}
	if (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		typeof error.code === "string" &&
		error.code.length > 0
	) {
		return error.code;
	}
	return "generation_run_failed";
}

export class GenerationRun extends WorkflowEntrypoint<Env, GenerationRunParams> {
	override async run(
		event: WorkflowEvent<GenerationRunParams>,
		step: WorkflowStep,
	): Promise<void> {
		const paramsResult = GenerationRunParamsSchema.safeParse(event.payload);
		if (!paramsResult.success) {
			throw new NonRetryableError(
				`Generation run params rejected: ${paramsResult.error.message}`,
				"invalid_generation_run_params",
			);
		}
		const params = paramsResult.data;
		let failureStep: GenerationRunFailure["step"] = "configure-generation-run";
		let completedSteps: GenerationStep[] = [];
		let modelUsage: ModelUsageRecord[] = [];
		try {
			const ports = await failNonRetryablyOnDeterministicErrors(() =>
				resolveGenerationPorts(this.env),
			);
			failureStep = "prepare-evidence";
			await step.do("record-run-running", BOUNDED_RETRIES, () =>
				recordGenerationRunProgress(
					this.env.DB,
					params,
					{ currentStep: "prepare-evidence", completedSteps, modelUsage },
					new Date().toISOString(),
				),
			);

			const preparedEvidence = await step.do("prepare-evidence", BOUNDED_RETRIES, () =>
				failNonRetryablyOnDeterministicErrors(async () => {
					const evidenceDate = evidenceDateForPublicationDate(params.publication_date);
					const messages = await ports.evidenceInput.loadEvidence({
						activeRegionId: params.active_region_id,
						evidenceDate,
					});
					if (messages.length === 0) {
						throw new NonRetryableError(
							`No evidence for active region ${params.active_region_id} on publication date ${params.publication_date} (evidence date ${evidenceDate})`,
							"no_evidence_for_publication_date",
						);
					}
					const prepared = prepareEvidence({
						activeRegionId: params.active_region_id,
						publicationDate: params.publication_date,
						messages,
					});
					assertWithinStepResultCap(prepared);
					return prepared;
				}),
			);
			completedSteps = ["prepare-evidence"];
			failureStep = "compose-main-story";
			await step.do("record-prepare-evidence-status", BOUNDED_RETRIES, () =>
				recordGenerationRunProgress(this.env.DB, params, {
					currentStep: "compose-main-story", completedSteps, modelUsage,
				}, new Date().toISOString()),
			);

			const mainStory = await step.do("compose-main-story", MODEL_STEP_CONFIG, () =>
				failNonRetryablyOnDeterministicErrors(async () => {
					const completion = await ports.modelProviders.main_story.complete({
						editorialCapability: "main_story",
						system: SYSTEM_CONSTRAINTS,
						user: buildMainStoryPrompt(preparedEvidence),
					});
					const output = parseMainStoryOutput(completion.text);
					return { main_story: output.main_story, completion };
				}),
			);
			completedSteps = ["prepare-evidence", "compose-main-story"];
			modelUsage = [modelUsageRecord("main_story", mainStory.completion)];
			failureStep = "compose-announcements";
			await step.do("record-main-story-status", BOUNDED_RETRIES, () =>
				recordGenerationRunProgress(this.env.DB, params, {
					currentStep: "compose-announcements", completedSteps, modelUsage,
				}, new Date().toISOString()),
			);

			const announcements = await step.do("compose-announcements", MODEL_STEP_CONFIG, () =>
				failNonRetryablyOnDeterministicErrors(async () => {
					const completion = await ports.modelProviders.announcements.complete({
						editorialCapability: "announcements",
						system: SYSTEM_CONSTRAINTS,
						user: buildAnnouncementsPrompt(preparedEvidence),
					});
					const output = parseAnnouncementsOutput(completion.text);
					return { announcements: output.announcements, completion };
				}),
			);
			completedSteps = [...completedSteps, "compose-announcements"];
			modelUsage = [...modelUsage, modelUsageRecord("announcements", announcements.completion)];
			failureStep = "compose-packaging";
			await step.do("record-announcements-status", BOUNDED_RETRIES, () =>
				recordGenerationRunProgress(this.env.DB, params, {
					currentStep: "compose-packaging", completedSteps, modelUsage,
				}, new Date().toISOString()),
			);

			const packaging = await step.do("compose-packaging", MODEL_STEP_CONFIG, () =>
				failNonRetryablyOnDeterministicErrors(async () => {
					const completion = await ports.modelProviders.packaging.complete({
						editorialCapability: "packaging",
						system: SYSTEM_CONSTRAINTS,
						user: buildPackagingPrompt(
							{ main_story: mainStory.main_story },
							{ announcements: announcements.announcements },
							{ activeRegionId: params.active_region_id, publicationDate: params.publication_date },
						),
					});
					const output = parsePackagingOutput(completion.text);
					return { title: output.title, subtitle: output.subtitle, completion };
				}),
			);
			completedSteps = [...completedSteps, "compose-packaging"];
			modelUsage = [...modelUsage, modelUsageRecord("packaging", packaging.completion)];
			failureStep = "validate-edition";
			await step.do("record-packaging-status", BOUNDED_RETRIES, () =>
				recordGenerationRunProgress(this.env.DB, params, {
					currentStep: "validate-edition", completedSteps, modelUsage,
				}, new Date().toISOString()),
			);

			const edition = await step.do("validate-edition", () =>
				failNonRetryablyOnDeterministicErrors(() =>
					assembleEdition({
						activeRegionId: params.active_region_id,
						publicationDate: params.publication_date,
						title: packaging.title,
						subtitle: packaging.subtitle,
						mainStory: mainStory.main_story,
						announcements: announcements.announcements,
						preparedEvidence,
						mainStoryProvenance: {
							provider: mainStory.completion.provider,
							model: mainStory.completion.model,
						},
						announcementsProvenance: {
							provider: announcements.completion.provider,
							model: announcements.completion.model,
						},
						packagingProvenance: {
							provider: packaging.completion.provider,
							model: packaging.completion.model,
						},
						generatedAtUtc: new Date().toISOString(),
					}),
				),
			);
			completedSteps = [...completedSteps, "validate-edition"];
			failureStep = "publish-edition";
			await step.do("record-validated-status", BOUNDED_RETRIES, () =>
				recordGenerationRunProgress(this.env.DB, params, {
					currentStep: "publish-edition", completedSteps, modelUsage,
				}, new Date().toISOString()),
			);

			await step.do("publish-edition", async () => {
				await publishEdition(this.env.DB, edition, new Date().toISOString());
			});
			await step.do("record-complete", BOUNDED_RETRIES, () =>
				recordGenerationRunComplete(this.env.DB, params, modelUsage, new Date().toISOString()),
			);
		} catch (error) {
			const failure: GenerationRunFailure = {
				step: failureStep,
				code: failureCode(error),
				message: error instanceof Error ? error.message : String(error),
			};
			try {
				await step.do("record-run-failure", BOUNDED_RETRIES, () =>
					recordGenerationRunFailure(this.env.DB, params, failure, new Date().toISOString()),
				);
			} catch (statusError) {
				console.error("Failed to record generation run failure", statusError);
			}
			throw error;
		}
	}
}
