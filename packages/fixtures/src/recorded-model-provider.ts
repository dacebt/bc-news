import type {
	ModelCompletion,
	ModelProviderPort,
	ProductionModelStep,
} from "@bc-news/generation-core";
import announcementsCopyeditResponseJson from "../model-responses/announcements_copyedit.json";
import announcementsWriteResponseJson from "../model-responses/announcements_write.json";
import mainStoryCopyeditResponseJson from "../model-responses/main_story_copyedit.json";
import mainStoryWriteResponseJson from "../model-responses/main_story_write.json";
import { modelRequestSha256 } from "./model-request-sha256";
import {
	RecordedModelProviderError,
	RecordedModelResponseSchema,
	type RecordedModelResponse,
} from "./recorded-response";

export type RecordedModelResponseRoster = Readonly<
	Record<ProductionModelStep, RecordedModelResponse>
>;

const committedRecordedModelResponses: RecordedModelResponseRoster = {
	main_story_write: RecordedModelResponseSchema.parse(mainStoryWriteResponseJson),
	main_story_copyedit: RecordedModelResponseSchema.parse(mainStoryCopyeditResponseJson),
	announcements_write: RecordedModelResponseSchema.parse(announcementsWriteResponseJson),
	announcements_copyedit: RecordedModelResponseSchema.parse(announcementsCopyeditResponseJson),
};

export function createRecordedModelProvider(roster: RecordedModelResponseRoster): ModelProviderPort {
	return {
		async complete(request): Promise<ModelCompletion> {
			const parsed = RecordedModelResponseSchema.parse(roster[request.productionStep]);
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
}

export const recordedModelProvider = createRecordedModelProvider(committedRecordedModelResponses);
