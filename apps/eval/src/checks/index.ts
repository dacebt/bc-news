import type { EditorialCapability, MainStoryOutput, PreparedEvidence } from "@bc-news/generation-core";
import { formattingCheck } from "./formatting";
import { groundingCheck } from "./grounding";
import { injectionCheck } from "./injection";
import { mainStoryStageSpecificCheck } from "./main-story-checks";
import type { NamedCheckResult } from "./common";

export interface CheckResult {
	readonly name: "injection" | "grounding" | "schema" | "formatting" | "stage_specific";
	readonly passed: boolean;
	readonly detail: string;
}

type EvalCheckRequest = {
	readonly editorialCapability: EditorialCapability;
	readonly rawText: string;
	readonly output: MainStoryOutput;
	readonly preparedEvidence: PreparedEvidence;
};

/**
 * Keyed by editorial capability so widening the roster (announcements,
 * packaging) is adding a Record entry, not restructuring this dispatch — the
 * Record type itself forces every new EditorialCapability to be handled.
 */
const STAGE_SPECIFIC_CHECKS: Record<
	EditorialCapability,
	(request: EvalCheckRequest) => NamedCheckResult<"stage_specific">
> = {
	main_story: (request) => mainStoryStageSpecificCheck(request.output),
};

export function runEvalChecks(request: EvalCheckRequest): readonly CheckResult[] {
	const { rawText, output, preparedEvidence } = request;
	return [
		injectionCheck(rawText),
		groundingCheck(output, preparedEvidence.messages),
		{ name: "schema", passed: true, detail: "Schema validation passed prior to check dispatch" },
		formattingCheck(output, preparedEvidence.messages),
		STAGE_SPECIFIC_CHECKS[request.editorialCapability](request),
	];
}
