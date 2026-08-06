import type { ModelCompletion, ModelProviderPort } from "@bc-news/generation-core";
import announcementsCopyeditResponseJson from "../model-responses/announcements_copyedit.json";
import announcementsWriteResponseJson from "../model-responses/announcements_write.json";
import mainStoryCopyeditResponseJson from "../model-responses/main_story_copyedit.json";
import mainStoryWriteResponseJson from "../model-responses/main_story_write.json";
import { modelRequestSha256 } from "./model-request-sha256";
import { RecordedModelProviderError, RecordedModelResponseSchema } from "./recorded-response";

const recordedResponsesByProductionStep: Readonly<Record<string, unknown>> = {
	main_story_write: mainStoryWriteResponseJson,
	main_story_copyedit: mainStoryCopyeditResponseJson,
	announcements_write: announcementsWriteResponseJson,
	announcements_copyedit: announcementsCopyeditResponseJson,
};

export const recordedModelProvider: ModelProviderPort = {
	async complete(request): Promise<ModelCompletion> {
		const recorded = recordedResponsesByProductionStep[request.productionStep];
		if (recorded === undefined) {
			throw new RecordedModelProviderError(
				"unknown_production_step",
				request.productionStep,
				`No recorded response exists for production step "${request.productionStep}"`,
			);
		}
		const parsed = RecordedModelResponseSchema.parse(recorded);
		if (parsed.production_step !== request.productionStep) {
			throw new RecordedModelProviderError(
				"recorded_response_step_mismatch",
				request.productionStep,
				`Recorded response declares production step "${parsed.production_step}" but was requested as "${request.productionStep}"`,
			);
		}
		const requestSha256 = await modelRequestSha256(request);
		if (parsed.prompt_sha256 !== requestSha256) {
			throw new RecordedModelProviderError(
				"recorded_response_prompt_mismatch",
				request.productionStep,
				`Recorded response prompt_sha256 "${parsed.prompt_sha256}" does not match request sha256 "${requestSha256}" for production step "${request.productionStep}"`,
			);
		}
		return {
			text: parsed.text,
			provider: parsed.provider,
			model: parsed.model,
			execution: "recorded_replay",
			token_usage: { measurement: "unavailable" },
			external_billing: {
				classification: "none",
				amount_usd: 0,
				reason: "recorded_replay",
			},
		};
	},
};
