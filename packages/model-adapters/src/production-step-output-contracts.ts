import { z } from "zod";
import {
	AnnouncementsWriterOutputSchema,
	MainStoryDraftSchema,
	type ProductionModelStep,
} from "@bc-news/generation-core";

type JsonSchema = Readonly<Record<string, unknown>>;

export interface ProductionStepOutputContract {
	readonly name: string;
	readonly schema: JsonSchema;
}

export type ProductionStepOutputContracts = Readonly<
	Record<ProductionModelStep, ProductionStepOutputContract>
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
			throw new Error("Production-step output schema must be inline without $ref or $defs");
		}
		if (node.type === "object" && "properties" in node && node.additionalProperties !== false) {
			throw new Error("Production-step output object schemas must reject additional properties");
		}
		for (const value of Object.values(node)) visit(value);
	};
	visit(schema);
}

export function productionStepOutputContract(
	name: string,
	schema: z.ZodType,
): ProductionStepOutputContract {
	if (!/^[A-Za-z0-9_-]+$/u.test(name)) {
		throw new Error("Production-step output schema name is invalid");
	}
	const inlineSchema = z.toJSONSchema(schema);
	delete inlineSchema.$schema;
	assertInlineStrictJsonSchema(inlineSchema);
	return { name, schema: inlineSchema };
}

export const PRODUCTION_STEP_OUTPUT_CONTRACTS: ProductionStepOutputContracts = {
	main_story_write: productionStepOutputContract("main_story_write_output", MainStoryDraftSchema),
	announcements_write: productionStepOutputContract(
		"announcements_write_output",
		AnnouncementsWriterOutputSchema,
	),
};
