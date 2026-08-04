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
	parseAnnouncementsOutput,
	parseMainStoryOutput,
	parsePackagingOutput,
	prepareEvidence,
	type PreparedEvidence,
} from "@bc-news/generation-core";
import { resolveGenerationPorts } from "./config";
import { publishEdition } from "./edition-store";
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
		const ports = await failNonRetryablyOnDeterministicErrors(() =>
			resolveGenerationPorts(this.env),
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

		const mainStory = await step.do("compose-main-story", MODEL_STEP_CONFIG, () =>
			failNonRetryablyOnDeterministicErrors(async () => {
				const completion = await ports.modelProviders.main_story.complete({
					editorialCapability: "main_story",
					system: SYSTEM_CONSTRAINTS,
					user: buildMainStoryPrompt(preparedEvidence),
				});
				const output = parseMainStoryOutput(completion.text);
				return {
					main_story: output.main_story,
					provider: completion.provider,
					model: completion.model,
				};
			}),
		);

		const announcements = await step.do("compose-announcements", MODEL_STEP_CONFIG, () =>
			failNonRetryablyOnDeterministicErrors(async () => {
				const completion = await ports.modelProviders.announcements.complete({
					editorialCapability: "announcements",
					system: SYSTEM_CONSTRAINTS,
					user: buildAnnouncementsPrompt(preparedEvidence),
				});
				const output = parseAnnouncementsOutput(completion.text);
				return {
					announcements: output.announcements,
					provider: completion.provider,
					model: completion.model,
				};
			}),
		);

		const packaging = await step.do("compose-packaging", MODEL_STEP_CONFIG, () =>
			failNonRetryablyOnDeterministicErrors(async () => {
				const completion = await ports.modelProviders.packaging.complete({
					editorialCapability: "packaging",
					system: SYSTEM_CONSTRAINTS,
					user: buildPackagingPrompt(
						{ main_story: mainStory.main_story },
						{ announcements: announcements.announcements },
						{
							activeRegionId: params.active_region_id,
							publicationDate: params.publication_date,
						},
					),
				});
				const output = parsePackagingOutput(completion.text);
				return {
					title: output.title,
					subtitle: output.subtitle,
					provider: completion.provider,
					model: completion.model,
				};
			}),
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
						provider: mainStory.provider,
						model: mainStory.model,
					},
					announcementsProvenance: {
						provider: announcements.provider,
						model: announcements.model,
					},
					packagingProvenance: {
						provider: packaging.provider,
						model: packaging.model,
					},
					generatedAtUtc: new Date().toISOString(),
				}),
			),
		);

		await step.do("publish-edition", async () => {
			await publishEdition(this.env.DB, edition, new Date().toISOString());
		});
	}
}
