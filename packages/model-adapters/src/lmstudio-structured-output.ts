import { z } from "zod";
import {
	AnnouncementsCopyeditOutputSchema,
	AnnouncementsWriterOutputSchema,
	MainStoryCopyeditOutputSchema,
	MainStoryDraftSchema,
	type ProductionModelStep,
} from "@bc-news/generation-core";
import { OpenAiCompatibleDeterministicError } from "./errors";

type JsonSchema = Readonly<Record<string, unknown>>;

export interface LmStudioStructuredOutputContract {
	readonly name: string;
	readonly schema: JsonSchema;
}

export type LmStudioStructuredOutputContracts = Readonly<
	Record<ProductionModelStep, LmStudioStructuredOutputContract>
>;

function assertInlineStrictJsonSchema(schema: JsonSchema): void {
	const visit = (candidate: unknown): void => {
		if (Array.isArray(candidate)) {
			for (const entry of candidate) visit(entry);
			return;
		}
		if (candidate === null || typeof candidate !== "object") return;
		const node = candidate as Record<string, unknown>;
		if ("$ref" in node || "$defs" in node) {
			throw new OpenAiCompatibleDeterministicError(
				"openai_compatible_invalid_config",
				"LM Studio structured output schema must be inline without $ref or $defs",
			);
		}
		if (node.type === "object" && "properties" in node && node.additionalProperties !== false) {
			throw new OpenAiCompatibleDeterministicError(
				"openai_compatible_invalid_config",
				"LM Studio structured output object schemas must reject additional properties",
			);
		}
		for (const value of Object.values(node)) visit(value);
	};
	visit(schema);
}

export function lmStudioStructuredOutputContract(
	name: string,
	schema: z.ZodType,
): LmStudioStructuredOutputContract {
	if (!/^[A-Za-z0-9_-]+$/u.test(name)) {
		throw new OpenAiCompatibleDeterministicError(
			"openai_compatible_invalid_config",
			"LM Studio structured output schema name is invalid",
		);
	}
	const inlineSchema = z.toJSONSchema(schema);
	delete inlineSchema.$schema;
	assertInlineStrictJsonSchema(inlineSchema);
	return { name, schema: inlineSchema };
}

export const LM_STUDIO_PRODUCTION_STEP_OUTPUT_CONTRACTS: LmStudioStructuredOutputContracts = {
	main_story_write: lmStudioStructuredOutputContract("main_story_write_output", MainStoryDraftSchema),
	main_story_copyedit: lmStudioStructuredOutputContract(
		"main_story_copyedit_output",
		MainStoryCopyeditOutputSchema,
	),
	announcements_write: lmStudioStructuredOutputContract(
		"announcements_write_output",
		AnnouncementsWriterOutputSchema,
	),
	announcements_copyedit: lmStudioStructuredOutputContract(
		"announcements_copyedit_output",
		AnnouncementsCopyeditOutputSchema,
	),
};
