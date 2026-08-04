import { z } from "zod";

export const RecordedModelResponseSchema = z.strictObject({
	editorial_capability: z.string().min(1),
	provider: z.string().min(1),
	model: z.string().min(1),
	prompt_sha256: z.string().regex(/^[0-9a-f]{64}$/),
	text: z.string().min(1),
});
export type RecordedModelResponse = z.infer<typeof RecordedModelResponseSchema>;

type RecordedModelProviderErrorCode =
	| "unknown_editorial_capability"
	| "recorded_response_capability_mismatch"
	| "recorded_response_prompt_mismatch";

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
