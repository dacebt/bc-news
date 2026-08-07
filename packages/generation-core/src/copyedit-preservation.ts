import type { ProductionModelStep } from "./ports";

type CopyeditStep = "main_story_copyedit" | "announcements_copyedit";
type CopyeditPreservationErrorCode =
	| "announcement_count"
	| "announcement_identity"
	| "field_shape"
	| "paragraph_count"
	| "quoted_span"
	| "numeric_literal"
	| "protected_markdown"
	| "protected_value";

export class CopyeditPreservationError extends Error {
	readonly productionStep: CopyeditStep;
	readonly code: CopyeditPreservationErrorCode;

	constructor(
		productionStep: CopyeditStep,
		code: CopyeditPreservationErrorCode,
		message: string,
	) {
		super(message);
		this.name = "CopyeditPreservationError";
		this.productionStep = productionStep;
		this.code = code;
	}
}

type TextFieldComparison = readonly [path: string, before: string, after: string];

function matches(text: string, pattern: RegExp): string[] {
	return Array.from(text.matchAll(pattern), (match) => match[0]);
}

const QUOTE_DELIMITERS = [
	["\"", "\""],
	["“", "”"],
	["'", "'"],
	["‘", "’"],
	["‚", "‘"],
	["‛", "’"],
	["«", "»"],
	["„", "“"],
	["「", "」"],
	["『", "』"],
	["《", "》"],
	["〈", "〉"],
	["〝", "〞"],
] as const;

function isLetterOrNumber(character: string | undefined): boolean {
	return character !== undefined && /[\p{L}\p{N}]/u.test(character);
}

function isSingleQuoteDelimiter(character: string): boolean {
	return character === "'" || character === "‘" || character === "’" || character === "‚" || character === "‛";
}

function isSingleQuoteOpener(text: string, index: number): boolean {
	return !isLetterOrNumber(text[index - 1]) && text[index + 1] !== undefined && !/\s/u.test(text[index + 1]!);
}

function findQuoteCloser(text: string, start: number, close: string): number {
	for (let index = start; index < text.length && text[index] !== "\n" && text[index] !== "\r"; index += 1) {
		if (text[index] !== close) {
			continue;
		}
		if (
			isSingleQuoteDelimiter(close)
			&& isLetterOrNumber(text[index - 1])
			&& isLetterOrNumber(text[index + 1])
		) {
			continue;
		}
		return index;
	}
	return -1;
}

function quotedSpans(text: string): string[] {
	const spans: string[] = [];
	for (let index = 0; index < text.length; index += 1) {
		const delimiters = QUOTE_DELIMITERS.find(([open]) => open === text[index]);
		if (delimiters === undefined) {
			continue;
		}
		const [open, close] = delimiters;
		if (isSingleQuoteDelimiter(open) && !isSingleQuoteOpener(text, index)) {
			continue;
		}
		const closeIndex = findQuoteCloser(text, index + open.length, close);
		if (closeIndex === -1) {
			continue;
		}
		spans.push(text.slice(index, closeIndex + close.length));
		index = closeIndex;
	}
	return spans;
}

function paragraphCount(text: string): number {
	const normalized = text
		.replace(/\r\n?|\u0085|\u2028/gu, "\n")
		.replace(/\u2029/gu, "\n\n")
		.trim();
	if (normalized === "") {
		return 0;
	}
	return normalized.split(/\n[^\S\n]*\n/u).length;
}

function sameOrderedValues(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function assertOrderedMatches(input: {
	productionStep: CopyeditStep;
	path: string;
	before: string;
	after: string;
	pattern: RegExp;
	code: "quoted_span" | "numeric_literal" | "protected_markdown";
	description: string;
}): void {
	const beforeMatches = matches(input.before, input.pattern);
	const afterMatches = matches(input.after, input.pattern);
	if (!sameOrderedValues(beforeMatches, afterMatches)) {
		throw new CopyeditPreservationError(
			input.productionStep,
			input.code,
			`Copyedit changed ${input.description} in ${input.path}`,
		);
	}
}

/**
 * Enforces observable structural and protected-token invariants around the
 * narrow copyedit pass. Passing these checks is not proof of factual or
 * semantic equivalence; the model can still change unprotected prose meaning.
 */
export function assertCopyeditPreservesTextFields(
	productionStep: Extract<ProductionModelStep, CopyeditStep>,
	fields: readonly TextFieldComparison[],
): void {
	for (const [path, before, after] of fields) {
		if (paragraphCount(before) !== paragraphCount(after)) {
			throw new CopyeditPreservationError(
				productionStep,
				"paragraph_count",
				`Copyedit changed paragraph count in ${path}`,
			);
		}
		if (!sameOrderedValues(quotedSpans(before), quotedSpans(after))) {
			throw new CopyeditPreservationError(
				productionStep,
				"quoted_span",
				`Copyedit changed quoted spans or their order in ${path}`,
			);
		}
		assertOrderedMatches({
			productionStep,
			path,
			before,
			after,
			pattern: /[+\-\p{Sm}\p{Pd}]?(?:\p{Nd}+(?:[\p{P}\p{Zs}]\p{Nd}+)*|[.,\u066B\u066C]\p{Nd}+)/gu,
			code: "numeric_literal",
			description: "numeric literals or their order",
		});
		assertOrderedMatches({
			productionStep,
			path,
			before,
			after,
			pattern: /\*\*[^*\n]+\*\*|(?<!\*)\*(?!\*)[^*\n]+\*(?!\*)|__[^_\n]+__|(?<!_)_(?!_)[^_\n]+_(?!_)/gu,
			code: "protected_markdown",
			description: "protected bold or italic spans or their order",
		});
	}
}
