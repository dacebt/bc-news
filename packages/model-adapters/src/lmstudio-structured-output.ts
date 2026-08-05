import { z } from "zod";
import {
	AnnouncementsOutputSchema,
	MainStoryOutputSchema,
	PackagingOutputSchema,
	type EditorialCapability,
} from "@bc-news/generation-core";
import { OpenAiCompatibleDeterministicError } from "./errors";

type JsonSchema = Readonly<Record<string, unknown>>;

export interface LmStudioStructuredOutputContract {
	readonly name: string;
	readonly schema: JsonSchema;
}

export type LmStudioStructuredOutputContracts = Readonly<
	Record<EditorialCapability, LmStudioStructuredOutputContract>
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

export const LM_STUDIO_CAPABILITY_OUTPUT_CONTRACTS: LmStudioStructuredOutputContracts = {
	main_story: lmStudioStructuredOutputContract("main_story_output", MainStoryOutputSchema),
	announcements: lmStudioStructuredOutputContract("announcements_output", AnnouncementsOutputSchema),
	packaging: lmStudioStructuredOutputContract("packaging_output", PackagingOutputSchema),
};
