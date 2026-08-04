import type { EditorialCapability } from "@bc-news/generation-core";

export interface RubricDimension {
	readonly name: string;
	readonly description: string;
	readonly weight: number;
}

export const RUBRICS: Record<EditorialCapability, readonly RubricDimension[]> = {
	main_story: [
		{
			name: "grounding",
			weight: 35,
			description: `Is this grounded or fiction? Verify:
- Events described actually happened (check against source)
- Quotes appear verbatim in the chat messages
- No invented statistics, meetings, or conversations
- Proper nouns only used when capitalized in source`,
		},
		{
			name: "voice",
			weight: 25,
			description: `Does this sound like the publication? Listen for:
- Straight, professional reporting tone
- Dry wit without winking at the reader
- Game events treated as genuine news
- No emoji, no em dashes, no AI flourishes`,
		},
		{
			name: "structure",
			weight: 40,
			description: `Does the piece flow? Assess:
- Strong headline that tells you what happened
- Lede that hooks without overselling
- Body that develops the story logically
- Proper paragraph breaks and pacing`,
		},
	],
};

export const RUBRIC_WEIGHT_TOTAL = 100;

export function rubricDimensionNames(capability: EditorialCapability): string[] {
	return RUBRICS[capability].map((dimension) => dimension.name);
}

export interface RubricDimensionMismatch {
	readonly missing: readonly string[];
	readonly unexpected: readonly string[];
}

export function rubricDimensionMismatch(
	capability: EditorialCapability,
	scores: Readonly<Record<string, number>>,
): RubricDimensionMismatch {
	const expected = new Set(rubricDimensionNames(capability));
	const actual = Object.keys(scores);
	return {
		missing: [...expected].filter((name) => !Object.hasOwn(scores, name)),
		unexpected: actual.filter((name) => !expected.has(name)),
	};
}

export function rubricWeightedAggregate(
	capability: EditorialCapability,
	scores: Readonly<Record<string, number>>,
): number {
	return RUBRICS[capability].reduce(
		(total, dimension) => total + scores[dimension.name]! * dimension.weight,
		0,
	) / RUBRIC_WEIGHT_TOTAL;
}
