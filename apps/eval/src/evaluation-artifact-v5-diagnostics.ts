import type { z } from "zod";
import { EvaluationFindingSchema } from "./evaluation-artifact-schemas";
import type {
	V1AnnouncementsProduct,
	V1MainStoryProduct,
	V1PreparedEvidence,
} from "./evaluation-artifact-v1-contracts";

type Diagnostic = z.infer<typeof EvaluationFindingSchema>;
type CopyeditStep = "main_story_copyedit" | "announcements_copyedit";
type PreservationCode = "announcement_count" | "announcement_identity" | "field_shape" | "paragraph_count" | "quoted_span" | "numeric_literal" | "protected_markdown" | "protected_value";

const QUOTE_DELIMITERS = [
	["\"", "\""], ["“", "”"], ["'", "'"], ["‘", "’"], ["‚", "‘"], ["‛", "’"],
	["«", "»"], ["„", "“"], ["「", "」"], ["『", "』"], ["《", "》"], ["〈", "〉"], ["〝", "〞"],
] as const;

function isLetterOrNumber(character: string | undefined): boolean {
	return character !== undefined && /[\p{L}\p{N}]/u.test(character);
}

function isSingleQuoteDelimiter(character: string): boolean {
	return character === "'" || character === "‘" || character === "’" || character === "‚" || character === "‛";
}

function quotedSpans(text: string): string[] {
	const spans: string[] = [];
	for (let index = 0; index < text.length; index += 1) {
		const delimiters = QUOTE_DELIMITERS.find(([open]) => open === text[index]);
		if (delimiters === undefined) continue;
		const [open, close] = delimiters;
		if (isSingleQuoteDelimiter(open) && (isLetterOrNumber(text[index - 1]) || text[index + 1] === undefined || /\s/u.test(text[index + 1]!))) continue;
		let closeIndex = -1;
		for (let candidate = index + open.length; candidate < text.length && text[candidate] !== "\n" && text[candidate] !== "\r"; candidate += 1) {
			if (text[candidate] === close && !(isSingleQuoteDelimiter(close) && isLetterOrNumber(text[candidate - 1]) && isLetterOrNumber(text[candidate + 1]))) {
				closeIndex = candidate;
				break;
			}
		}
		if (closeIndex < 0) continue;
		spans.push(text.slice(index, closeIndex + close.length));
		index = closeIndex;
	}
	return spans;
}

function matches(text: string, pattern: RegExp): string[] {
	return Array.from(text.matchAll(pattern), (match) => match[0]);
}

function same(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function paragraphCount(text: string): number {
	const normalized = text.replace(/\r\n?|\u0085|\u2028/gu, "\n").replace(/\u2029/gu, "\n\n").trim();
	return normalized === "" ? 0 : normalized.split(/\n[^\S\n]*\n/u).length;
}

function preservationDiagnostic(step: CopyeditStep, code: PreservationCode, message: string): Diagnostic {
	return { kind: "preservation", production_step: step, code, message };
}

function textFieldDiagnostics(step: CopyeditStep, fields: readonly (readonly [string, string, string])[]): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	for (const [path, before, after] of fields) {
		if (paragraphCount(before) !== paragraphCount(after)) diagnostics.push(preservationDiagnostic(step, "paragraph_count", `Copyedit changed paragraph count in ${path}`));
		if (!same(quotedSpans(before), quotedSpans(after))) diagnostics.push(preservationDiagnostic(step, "quoted_span", `Copyedit changed quoted spans or their order in ${path}`));
		if (!same(matches(before, /[+\-\p{Sm}\p{Pd}]?(?:\p{Nd}+(?:[\p{P}\p{Zs}]\p{Nd}+)*|[.,\u066B\u066C]\p{Nd}+)/gu), matches(after, /[+\-\p{Sm}\p{Pd}]?(?:\p{Nd}+(?:[\p{P}\p{Zs}]\p{Nd}+)*|[.,\u066B\u066C]\p{Nd}+)/gu))) diagnostics.push(preservationDiagnostic(step, "numeric_literal", `Copyedit changed numeric literals or their order in ${path}`));
		if (!same(matches(before, /\*\*[^*\n]+\*\*|(?<!\*)\*(?!\*)[^*\n]+\*(?!\*)|__[^_\n]+__|(?<!_)_(?!_)[^_\n]+_(?!_)/gu), matches(after, /\*\*[^*\n]+\*\*|(?<!\*)\*(?!\*)[^*\n]+\*(?!\*)|__[^_\n]+__|(?<!_)_(?!_)[^_\n]+_(?!_)/gu))) diagnostics.push(preservationDiagnostic(step, "protected_markdown", `Copyedit changed protected bold or italic spans or their order in ${path}`));
	}
	return diagnostics;
}

export function v5MainStoryPreservationDiagnostics(before: V1MainStoryProduct, after: V1MainStoryProduct): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	if ((before.main_story.image === undefined) !== (after.main_story.image === undefined)) diagnostics.push(preservationDiagnostic("main_story_copyedit", "field_shape", "Copyedit changed the optional main-story image shape"));
	if (before.main_story.image !== undefined && after.main_story.image !== undefined && before.main_story.image.url !== after.main_story.image.url) diagnostics.push(preservationDiagnostic("main_story_copyedit", "protected_value", "Copyedit changed the main-story image URL"));
	if (before.main_story.image !== undefined && after.main_story.image !== undefined && (before.main_story.image.credit === undefined) !== (after.main_story.image.credit === undefined)) diagnostics.push(preservationDiagnostic("main_story_copyedit", "field_shape", "Copyedit changed the optional main-story image credit shape"));
	const fields: Array<readonly [string, string, string]> = [
		["title", before.title, after.title], ["subtitle", before.subtitle, after.subtitle],
		["main_story.headline", before.main_story.headline, after.main_story.headline],
		["main_story.lede", before.main_story.lede, after.main_story.lede],
		["main_story.body", before.main_story.body, after.main_story.body],
	];
	if (before.main_story.image !== undefined && after.main_story.image !== undefined) {
		fields.push(["main_story.image.caption", before.main_story.image.caption, after.main_story.image.caption]);
		if (before.main_story.image.credit !== undefined && after.main_story.image.credit !== undefined) fields.push(["main_story.image.credit", before.main_story.image.credit, after.main_story.image.credit]);
	}
	diagnostics.push(...textFieldDiagnostics("main_story_copyedit", fields));
	return diagnostics;
}

export function v5AnnouncementsPreservationDiagnostics(
	before: ReturnType<typeof attachV5AnnouncementIds>,
	after: ReturnType<typeof attachV5AnnouncementIds>,
): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	if (after.announcements.length !== before.announcements.length) diagnostics.push(preservationDiagnostic("announcements_copyedit", "announcement_count", "Copyedit changed the announcement count"));
	for (let index = 0; index < Math.min(before.announcements.length, after.announcements.length); index += 1) {
		const previous = before.announcements[index]!;
		const current = after.announcements[index]!;
		if (current.id !== previous.id) diagnostics.push(preservationDiagnostic("announcements_copyedit", "announcement_identity", `Copyedit changed or reordered announcement id ${previous.id} at index ${index}`));
		diagnostics.push(...textFieldDiagnostics("announcements_copyedit", [
			[`announcements.${index}.title`, previous.title, current.title],
			[`announcements.${index}.summary`, previous.summary, current.summary],
		]));
	}
	return diagnostics;
}

export function attachV5AnnouncementIds(product: V1AnnouncementsProduct) {
	return { announcements: product.announcements.map((announcement, index) => ({ id: `announcement-${index + 1}`, ...announcement })) };
}

const FORBIDDEN_PATTERNS = [/ignore\s+previous\s+instructions/iu, /system\s+prompt/iu, /developer\s+message/iu, /as\s+(?:an?\s+)?AI\b/iu, /```/u, /^#{1,6}\s/mu, /—/u] as const;

function normalized(value: string): string {
	return value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/gu, " ").trim();
}

function finalProductDiagnostics(step: CopyeditStep, editorialText: readonly string[], groundedText: string, evidence: V1PreparedEvidence): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	const joined = editorialText.join("\n");
	for (const pattern of FORBIDDEN_PATTERNS) {
		const match = pattern.exec(joined);
		if (match !== null) diagnostics.push({ kind: "final_product", production_step: step, code: "forbidden_marker", message: `Forbidden output marker: ${match[0]}` });
	}
	const source = normalized(evidence.messages.map((message) => `${message.author_name} ${message.text}`).join(" "));
	for (const match of groundedText.matchAll(/\*\*([^*]+)\*\*/gu)) {
		const marked = normalized(match[1] ?? "");
		if (marked !== "" && !source.includes(marked)) diagnostics.push({ kind: "final_product", production_step: step, code: "ungrounded_marked_name", message: `Ungrounded marked name: ${match[1]}` });
	}
	for (const match of groundedText.matchAll(/["“]([^"”]{2,})["”]/gu)) {
		const quote = normalized(match[1] ?? "");
		if (quote !== "" && !source.includes(quote)) diagnostics.push({ kind: "final_product", production_step: step, code: "ungrounded_quote", message: `Ungrounded quote: ${match[1]}` });
	}
	return diagnostics;
}

export function v5MainStoryFinalProductDiagnostics(product: V1MainStoryProduct, evidence: V1PreparedEvidence): Diagnostic[] {
	return finalProductDiagnostics("main_story_copyedit", [product.title, product.subtitle, product.main_story.headline, product.main_story.lede, product.main_story.body], [product.main_story.headline, product.main_story.lede, product.main_story.body].join(" "), evidence);
}

export function v5AnnouncementsFinalProductDiagnostics(product: V1AnnouncementsProduct, evidence: V1PreparedEvidence): Diagnostic[] {
	const text = product.announcements.flatMap((announcement) => [announcement.title, announcement.summary]);
	return finalProductDiagnostics("announcements_copyedit", text, text.join(" "), evidence);
}
