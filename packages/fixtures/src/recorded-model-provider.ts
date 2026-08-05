import type { ModelCompletion, ModelProviderPort } from "@bc-news/generation-core";
import announcementsResponseJson from "../model-responses/announcements.json";
import mainStoryResponseJson from "../model-responses/main_story.json";
import packagingResponseJson from "../model-responses/packaging.json";
import { RecordedModelProviderError, RecordedModelResponseSchema } from "./recorded-response";

const recordedResponsesByEditorialCapability: Readonly<Record<string, unknown>> = {
	main_story: mainStoryResponseJson,
	announcements: announcementsResponseJson,
	packaging: packagingResponseJson,
};

/**
 * Keyed by editorial capability only, deliberately: a prompt-hash key would
 * break the walk on every prompt edit, and warning-and-continuing on a hash
 * mismatch would be a silent fallback. The recorded prompt_sha256 is
 * informational provenance, never branched on.
 */
export const recordedModelProvider: ModelProviderPort = {
	complete(request): Promise<ModelCompletion> {
		const recorded =
			recordedResponsesByEditorialCapability[request.editorialCapability];
		if (recorded === undefined) {
			throw new RecordedModelProviderError(
				"unknown_editorial_capability",
				request.editorialCapability,
				`No recorded response exists for editorial capability "${request.editorialCapability}"`,
			);
		}
		const parsed = RecordedModelResponseSchema.parse(recorded);
		if (parsed.editorial_capability !== request.editorialCapability) {
			throw new RecordedModelProviderError(
				"recorded_response_capability_mismatch",
				request.editorialCapability,
				`Recorded response declares editorial capability "${parsed.editorial_capability}" but was requested as "${request.editorialCapability}"`,
			);
		}
		return Promise.resolve({
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
		});
	},
};
