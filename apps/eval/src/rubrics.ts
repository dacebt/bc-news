import type { EditorialCapability } from "@bc-news/generation-core";

export interface RubricDimension {
	readonly name: string;
	readonly description: string;
	readonly weight: number;
}

export const RUBRICS: Record<EditorialCapability, readonly RubricDimension[]> = {
	announcements: [
		{
			name: "completeness",
			weight: 35,
			description: `Did the output capture what happened? Look for:
- Skill progressions and milestones mentioned in the source
- Personal achievements worth noting
- Discoveries or territorial developments
- Missing events that should have been reported`,
		},
		{
			name: "accuracy",
			weight: 35,
			description: `Is the reporting trustworthy? Check:
- Player names match the source exactly
- Levels and achievements correspond to what was said
- No embellishment or invented details
- Quotes (if any) appear verbatim in source`,
		},
		{
			name: "clarity",
			weight: 15,
			description: `Is the writing professional? Consider:
- Clear, straightforward language
- Appropriate level of detail
- Consistent style across announcements
- No awkward phrasing or jargon`,
		},
		{
			name: "coverage_quality",
			weight: 15,
			description: `Does the announcement selection use the source well? Evaluate:
- Newsworthy source events are represented without material omissions
- Duplicate or trivial announcements do not crowd out stronger events
- Emphasis reflects the significance of the source activity`,
		},
	],
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
	packaging: [
		{
			name: "preservation",
			weight: 30,
			description: `Was the previous stage's work respected? Check:
- Original voice maintained throughout
- Changes limited to factual corrections and typos
- No over-editing or unnecessary tightening
- Narrative structure preserved`,
		},
		{
			name: "accuracy",
			weight: 25,
			description: `Is the final product clean? Look for:
- Factual errors caught and fixed
- No new errors introduced
- Quotes verified against source
- Numbers and names correct`,
		},
		{
			name: "packaging",
			weight: 20,
			description: `Does this feel like a finished product? Consider:
- Appropriate edition title and subtitle
- Professional presentation
- Coherent package of announcements and story
- Ready for reader consumption`,
		},
		{
			name: "metadata",
			weight: 25,
			description: `Are the edition identity fields correct? Verify:
- Region ID and edition date match the expected values
- Title and subtitle are present and appropriate
- All required package fields are populated
- No unsupported metadata was invented`,
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
