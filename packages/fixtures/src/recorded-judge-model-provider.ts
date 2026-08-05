import type { ModelCompletion, ModelProviderPort } from "@bc-news/generation-core";
import judgeAnnouncementsResponseJson from "../model-responses/judge/announcements.json";
import judgeMainStoryResponseJson from "../model-responses/judge/main_story.json";
import judgePackagingResponseJson from "../model-responses/judge/packaging.json";
import { RecordedModelProviderError, RecordedModelResponseSchema } from "./recorded-response";

const recordedJudgeResponsesByEditorialCapability: Readonly<Record<string, unknown>> = {
	announcements: judgeAnnouncementsResponseJson,
	main_story: judgeMainStoryResponseJson,
	packaging: judgePackagingResponseJson,
};

export async function modelRequestSha256(request: {
	readonly system: string;
	readonly user: string;
}): Promise<string> {
	const bytes = new TextEncoder().encode(JSON.stringify({ system: request.system, user: request.user }));
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const recordedJudgeModelProvider: ModelProviderPort = {
	async complete(request): Promise<ModelCompletion> {
		const recorded = recordedJudgeResponsesByEditorialCapability[request.editorialCapability];
		if (recorded === undefined) {
			throw new RecordedModelProviderError(
				"unknown_editorial_capability",
				request.editorialCapability,
				`No recorded judge response exists for editorial capability "${request.editorialCapability}"`,
			);
		}
		const parsed = RecordedModelResponseSchema.parse(recorded);
		if (parsed.editorial_capability !== request.editorialCapability) {
			throw new RecordedModelProviderError(
				"recorded_response_capability_mismatch",
				request.editorialCapability,
				`Recorded judge response declares editorial capability "${parsed.editorial_capability}" but was requested as "${request.editorialCapability}"`,
			);
		}
		const actualPromptSha256 = await modelRequestSha256(request);
		if (parsed.prompt_sha256 !== actualPromptSha256) {
			throw new RecordedModelProviderError(
				"recorded_response_prompt_mismatch",
				request.editorialCapability,
				`Recorded judge response for editorial capability "${request.editorialCapability}" was captured for prompt ${parsed.prompt_sha256}, not requested prompt ${actualPromptSha256}`,
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
