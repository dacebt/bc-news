import { z } from "zod";
import { ProductionModelStepSchema } from "@bc-news/generation-core";

export const RecordedModelResponseSchema = z.strictObject({
	production_step: ProductionModelStepSchema,
	provider: z.string().min(1),
	model: z.string().min(1),
	prompt_sha256: z.string().regex(/^[0-9a-f]{64}$/),
	text: z.string().min(1),
});
export type RecordedModelResponse = z.infer<typeof RecordedModelResponseSchema>;

type RecordedModelProviderErrorCode =
	| "unknown_production_step"
	| "recorded_response_step_mismatch"
	| "recorded_response_prompt_mismatch";

export class RecordedModelProviderError extends Error {
	readonly code: RecordedModelProviderErrorCode;
	readonly productionStep: string;

	constructor(
		code: RecordedModelProviderErrorCode,
		productionStep: string,
		message: string,
	) {
		super(message);
		this.name = "RecordedModelProviderError";
		this.code = code;
		this.productionStep = productionStep;
	}
}
