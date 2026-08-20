import { EditionSchema } from "@bc-news/contracts";
import type { EvalProducts } from "./production-step-runners";
import { allDifferences } from "./run-difference";

export interface FinalProductComparison {
	readonly differences: readonly string[];
}

interface ComparableRun {
	readonly edition?: unknown;
	readonly steps: readonly { readonly output?: unknown }[];
}

export function compareFinalEditorialProducts(
	left: EvalProducts,
	right: EvalProducts,
): FinalProductComparison {
	return { differences: allDifferences(left, right) };
}

export function finalEditorialProductsFromEdition(edition: unknown): EvalProducts {
	const parsed = EditionSchema.parse(edition);
	return {
		mainStory: {
			title: parsed.title,
			main_story: parsed.main_story,
		},
		announcements: { announcements: parsed.announcements },
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function historicalFinalEditorialProducts(run: ComparableRun): Record<string, unknown> {
	const mainStory: Record<string, unknown> = {};
	const announcements: Record<string, unknown> = {};
	for (const step of run.steps) {
		if (!isRecord(step.output)) continue;
		if (Object.hasOwn(step.output, "title")) mainStory.title = step.output.title;
		if (Object.hasOwn(step.output, "main_story")) mainStory.main_story = step.output.main_story;
		if (Object.hasOwn(step.output, "announcements")) {
			announcements.announcements = step.output.announcements;
		}
	}
	return {
		...(Object.keys(mainStory).length > 0 ? { mainStory } : {}),
		...(Object.keys(announcements).length > 0 ? { announcements } : {}),
	};
}

export function compareRetainedFinalEditorialProducts(
	left: ComparableRun,
	right: ComparableRun,
): FinalProductComparison {
	const products = (run: ComparableRun): unknown => run.edition === undefined
		? historicalFinalEditorialProducts(run)
		: finalEditorialProductsFromEdition(run.edition);
	return { differences: allDifferences(products(left), products(right)) };
}
