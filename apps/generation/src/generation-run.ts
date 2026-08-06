import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { GenerationRunParamsSchema, type GenerationRunParams } from "@bc-news/contracts";
import {
	COPYEDIT_SYSTEM_CONSTRAINTS,
	WRITER_SYSTEM_CONSTRAINTS,
	assembleEdition,
	attachAnnouncementIds,
	buildAnnouncementsCopyeditPrompt,
	buildAnnouncementsWriterPrompt,
	buildMainStoryCopyeditPrompt,
	buildMainStoryWriterPrompt,
	evidenceDateForPublicationDate,
	modelUsageRecord,
	parseAnnouncementsCopyeditOutput,
	parseAnnouncementsWriterOutput,
	parseMainStoryCopyeditOutput,
	parseMainStoryWriterOutput,
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
	if (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		typeof error.code === "string" &&
		error.code.length > 0
	) {
		return error.code;
	}
	if (error instanceof Error && error.name === "Error") {
		const serializedCode = error.message.match(/^([a-z][a-z0-9_]*): /)?.[1];
		if (serializedCode !== undefined) return serializedCode;
	}
	if (error instanceof Error && error.name !== "Error") return error.name;
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
			failureStep = "main_story_write";
			await step.do("record-prepare-evidence-status", BOUNDED_RETRIES, () =>
				recordGenerationRunProgress(this.env.DB, params, {
					currentStep: "main_story_write",
					completedSteps,
					modelUsage,
				}, new Date().toISOString()),
			);

			const mainStoryDraft = await step.do("main_story_write", MODEL_STEP_CONFIG, () =>
				failNonRetryablyOnDeterministicErrors(async () => {
					const completion = await ports.modelProviders.main_story_write.complete({
						productionStep: "main_story_write",
						system: WRITER_SYSTEM_CONSTRAINTS,
						user: buildMainStoryWriterPrompt(preparedEvidence),
					});
					return { product: parseMainStoryWriterOutput(completion.text), completion };
				}),
			);
			completedSteps = [...completedSteps, "main_story_write"];
			modelUsage = [...modelUsage, modelUsageRecord("main_story_write", mainStoryDraft.completion)];
			failureStep = "main_story_copyedit";
			await step.do("record-main-story-write-status", BOUNDED_RETRIES, () =>
				recordGenerationRunProgress(this.env.DB, params, {
					currentStep: "main_story_copyedit",
					completedSteps,
					modelUsage,
				}, new Date().toISOString()),
			);

			const mainStory = await step.do("main_story_copyedit", MODEL_STEP_CONFIG, () =>
				failNonRetryablyOnDeterministicErrors(async () => {
					const completion = await ports.modelProviders.main_story_copyedit.complete({
						productionStep: "main_story_copyedit",
						system: COPYEDIT_SYSTEM_CONSTRAINTS,
						user: buildMainStoryCopyeditPrompt(mainStoryDraft.product),
					});
					return {
						product: parseMainStoryCopyeditOutput(completion.text, mainStoryDraft.product),
						completion,
					};
				}),
			);
			completedSteps = [...completedSteps, "main_story_copyedit"];
			modelUsage = [...modelUsage, modelUsageRecord("main_story_copyedit", mainStory.completion)];
			failureStep = "announcements_write";
			await step.do("record-main-story-copyedit-status", BOUNDED_RETRIES, () =>
				recordGenerationRunProgress(this.env.DB, params, {
					currentStep: "announcements_write",
					completedSteps,
					modelUsage,
				}, new Date().toISOString()),
			);

			const announcementsDraft = await step.do("announcements_write", MODEL_STEP_CONFIG, () =>
				failNonRetryablyOnDeterministicErrors(async () => {
					const completion = await ports.modelProviders.announcements_write.complete({
						productionStep: "announcements_write",
						system: WRITER_SYSTEM_CONSTRAINTS,
						user: buildAnnouncementsWriterPrompt(preparedEvidence),
					});
					return { product: parseAnnouncementsWriterOutput(completion.text), completion };
				}),
			);
			completedSteps = [...completedSteps, "announcements_write"];
			modelUsage = [...modelUsage, modelUsageRecord("announcements_write", announcementsDraft.completion)];
			failureStep = "announcements_copyedit";
			await step.do("record-announcements-write-status", BOUNDED_RETRIES, () =>
				recordGenerationRunProgress(this.env.DB, params, {
					currentStep: "announcements_copyedit",
					completedSteps,
					modelUsage,
				}, new Date().toISOString()),
			);

			const identifiedAnnouncements = attachAnnouncementIds(announcementsDraft.product);
			const announcements = await step.do("announcements_copyedit", MODEL_STEP_CONFIG, () =>
				failNonRetryablyOnDeterministicErrors(async () => {
					const completion = await ports.modelProviders.announcements_copyedit.complete({
						productionStep: "announcements_copyedit",
						system: COPYEDIT_SYSTEM_CONSTRAINTS,
						user: buildAnnouncementsCopyeditPrompt(identifiedAnnouncements),
					});
					return {
						product: parseAnnouncementsCopyeditOutput(completion.text, identifiedAnnouncements),
						completion,
					};
				}),
			);
			completedSteps = [...completedSteps, "announcements_copyedit"];
			modelUsage = [...modelUsage, modelUsageRecord("announcements_copyedit", announcements.completion)];
			failureStep = "validate-edition";
			await step.do("record-announcements-copyedit-status", BOUNDED_RETRIES, () =>
				recordGenerationRunProgress(this.env.DB, params, {
					currentStep: "validate-edition",
					completedSteps,
					modelUsage,
				}, new Date().toISOString()),
			);

			const edition = await step.do("validate-edition", () =>
				failNonRetryablyOnDeterministicErrors(() => assembleEdition({
					mainStory: mainStory.product,
					announcements: announcements.product,
					preparedEvidence,
					generatedAtUtc: new Date().toISOString(),
					modelUsages: modelUsage,
				})),
			);
			completedSteps = [...completedSteps, "validate-edition"];
			failureStep = "publish-edition";
			await step.do("record-validated-status", BOUNDED_RETRIES, () =>
				recordGenerationRunProgress(this.env.DB, params, {
					currentStep: "publish-edition",
					completedSteps,
					modelUsage,
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
