import type { MainStoryOutput } from "@bc-news/generation-core";
import { checkResult, type NamedCheckResult } from "./common";

/**
 * Ported from v1's stage-2 narrative check (paragraph development, list-like
 * structure, formulaic sentence counts). v1's stage-3 checks — word-overlap
 * and length-ratio comparisons against an earlier LLM-authored draft — are
 * dropped, not ported: v2 packaging composes deterministically from
 * already-generated capability outputs rather than an LLM rewriting a prior
 * stage's prose, so there is no earlier draft to preserve and nothing for a
 * preservation check to compare against. When packaging becomes an eval
 * capability, its stage_specific entry gets whatever check that shape
 * actually needs — not a reduced form of this one.
 */
export function mainStoryStageSpecificCheck(output: MainStoryOutput): NamedCheckResult<"stage_specific"> {
	const body = output.main_story.body;
	const paragraphs = body.split("\n\n");
	const issues: string[] = [];
	if (paragraphs.length < 2) issues.push("Single paragraph lacks narrative development");
	const listLike = paragraphs.filter((paragraph) => {
		const start = paragraph.trim().slice(0, 50).toLowerCase();
		return start.startsWith("**") || /^(meanwhile|then|next|after|later)/.test(start);
	}).length;
	if (paragraphs.length >= 3 && listLike >= paragraphs.length * 0.7) {
		issues.push("List-like paragraph structure detected");
	}
	if (!body.includes('"') && !/\b\d+\b/.test(body) && body.length < 2000) {
		issues.push("Story lacks quotes and specific numeric detail");
	}
	const sentenceCounts = paragraphs.map((paragraph) => paragraph
		.split(/[.!?]+\s+/)
		.filter((sentence) => sentence.trim().length > 0).length);
	if (sentenceCounts.length >= 3) {
		const twoSentenceCount = sentenceCounts.filter((count) => count === 2).length;
		if (twoSentenceCount / sentenceCounts.length > 0.6) issues.push("Paragraph structure is formulaic");
		if (new Set(sentenceCounts).size === 1) issues.push("Paragraphs have no sentence-count variation");
		const average = sentenceCounts.reduce((sum, count) => sum + count, 0) / sentenceCounts.length;
		if (sentenceCounts.length >= 4 && average < 3) issues.push("Paragraphs are too short on average");
	}
	return checkResult("stage_specific", issues, `Narrative has ${paragraphs.length} paragraphs`);
}
