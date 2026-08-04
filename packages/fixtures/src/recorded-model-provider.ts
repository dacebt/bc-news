import { z } from "zod";
import type { ModelProviderPort } from "@bc-news/generation-core";
import announcementsResponseJson from "../model-responses/announcements.json";
import mainStoryResponseJson from "../model-responses/main_story.json";
import packagingResponseJson from "../model-responses/packaging.json";

const RecordedModelResponseSchema = z.strictObject({
	editorial_capability: z.string().min(1),
	provider: z.string().min(1),
	model: z.string().min(1),
	prompt_sha256: z.string().regex(/^[0-9a-f]{64}$/),
	text: z.string().min(1),
});

type RecordedModelProviderErrorCode =
	| "unknown_editorial_capability"
	| "recorded_response_capability_mismatch";

export class RecordedModelProviderError extends Error {
	readonly code: RecordedModelProviderErrorCode;
	readonly editorialCapability: string;

	constructor(
		code: RecordedModelProviderErrorCode,
		editorialCapability: string,
		message: string,
	) {
		super(message);
		this.name = "RecordedModelProviderError";
		this.code = code;
		this.editorialCapability = editorialCapability;
	}
}

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
	complete(request): Promise<{ text: string; provider: string; model: string }> {
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
		});
	},
};
