import type {
	ModelCompletion,
	ModelProviderPort,
	ProductionModelStep,
} from "@bc-news/generation-core";
import announcementsWriteResponseJson from "../model-responses/announcements_write.json";
import mainStoryWriteResponseJson from "../model-responses/main_story_write.json";
import {
	RecordedModelProviderError,
	RecordedModelResponseSchema,
	type RecordedModelResponse,
	type RecordedModelResponseV2,
	type RecordedModelResponseV3,
} from "./recorded-response";

export type RecordedModelResponseRoster = Readonly<
	Record<ProductionModelStep, RecordedModelResponse>
>;

export type RecordedModelResponseV2Roster = Readonly<
	Record<ProductionModelStep, RecordedModelResponseV2>
>;

export type RecordedModelResponseV3Roster = Readonly<
	Record<ProductionModelStep, RecordedModelResponseV3>
>;

const committedRecordedModelResponses: RecordedModelResponseRoster = {
	main_story_write: RecordedModelResponseSchema.parse(mainStoryWriteResponseJson),
	announcements_write: RecordedModelResponseSchema.parse(announcementsWriteResponseJson),
};

const MAIN_STORY_FIRST_ATTEMPT_INVALID_JSON = "not json";

function retryAwareRecordedText(
	request: Parameters<ModelProviderPort["complete"]>[0],
	response: RecordedModelResponse,
): string {
	const correlation = request.correlation;
	if (correlation === undefined || request.productionStep !== "main_story_write") {
		return response.text;
	}
	if (
		correlation.invocation_id ===
			`${correlation.run_id}-${request.productionStep}-attempt-1`
	) {
		return MAIN_STORY_FIRST_ATTEMPT_INVALID_JSON;
	}
	return response.text;
}

export function createRecordedModelProvider(roster: RecordedModelResponseRoster): ModelProviderPort {
	return {
		complete(request): Promise<ModelCompletion> {
			return Promise.resolve().then(() => {
				const parsed = RecordedModelResponseSchema.parse(roster[request.productionStep]);
				if (parsed.production_step !== request.productionStep) {
					throw new RecordedModelProviderError(
						"recorded_response_step_mismatch",
						request.productionStep,
						`Recorded response declares production step "${parsed.production_step}" but was requested as "${request.productionStep}"`,
					);
				}
				return {
					text: retryAwareRecordedText(request, parsed),
					provider: parsed.provider,
					model: parsed.model,
					execution: "recorded_replay" as const,
					token_usage: { measurement: "unavailable" as const },
					external_billing: {
						classification: "none" as const,
						amount_usd: 0 as const,
						reason: "recorded_replay" as const,
					},
				};
			});
		},
	};
}

export const recordedModelProvider = createRecordedModelProvider(committedRecordedModelResponses);
