import { expect, test } from "vitest";
import {
	EditorialDiagnosticSchema,
	EditorialOutputContractError,
	parseMainStoryCopyeditOutput,
	parseMainStoryCopyeditOutputWithDiagnostics,
	parseMainStoryWriterOutput,
	type MainStoryDraft,
} from "../src/index";

const DRAFT = {
	title: "The Region Seven Gazette",
	subtitle: "Trade Talks and 230 Missing Shipments",
	main_story: {
		headline: "Builders Debate a Difficult Route",
		lede: "The region called it \"a rough road\" before regrouping.",
		body: "**KitServal** reported 230 lost shipments while *builders* compared routes.\n\nThe group called the northern path \"a rough road\" and kept planning.",
	},
};

function diagnosticCodes(text: string, draft: MainStoryDraft = DRAFT): string[] {
	return parseMainStoryCopyeditOutputWithDiagnostics(text, draft).diagnostics.map(
		(diagnostic) => diagnostic.code,
	);
}

test("copyedit accepts grammar changes that preserve protected content and paragraph count", () => {
	const edited = {
		...DRAFT,
		main_story: {
			...DRAFT.main_story,
			body: "**KitServal** reported 230 lost shipments as *builders* compared routes.\n\nThe group called the northern path \"a rough road\" and continued planning.",
		},
	};

	expect(parseMainStoryCopyeditOutput(JSON.stringify(edited))).toEqual(edited);
	expect(parseMainStoryCopyeditOutputWithDiagnostics(JSON.stringify(edited), DRAFT)).toEqual({
		product: edited,
		diagnostics: [],
	});
});

test("copyedit accepts removal of trailing whitespace-only paragraph separators", () => {
	const draft = {
		...DRAFT,
		main_story: { ...DRAFT.main_story, body: `${DRAFT.main_story.body}\n\n` },
	};

	expect(parseMainStoryCopyeditOutput(JSON.stringify(DRAFT))).toEqual(DRAFT);
	expect(diagnosticCodes(JSON.stringify(DRAFT), draft)).toEqual([]);
});

test.each([
	["paragraph count", DRAFT.main_story.body.replace("\n\n", " "), "paragraph_count"],
	["quoted span", DRAFT.main_story.body.replace("\"a rough road\"", "\"an easy road\""), "quoted_span"],
	["numeric literal", DRAFT.main_story.body.replace("230", "231"), "numeric_literal"],
	["numeric literal sign", DRAFT.main_story.body.replace("230", "-230"), "numeric_literal"],
	["bold span", DRAFT.main_story.body.replace("**KitServal**", "**Kit**"), "protected_markdown"],
	["italic span", DRAFT.main_story.body.replace("*builders*", "*haulers*"), "protected_markdown"],
] as const)("copyedit reports changed %s without rejecting the product", (_label, body, code) => {
	const edited = { ...DRAFT, main_story: { ...DRAFT.main_story, body } };

	expect(parseMainStoryCopyeditOutput(JSON.stringify(edited))).toEqual(edited);
	expect(diagnosticCodes(JSON.stringify(edited))).toContain(code);
});

test("copyedit reports removal of a CRLF paragraph separator", () => {
	const draft = {
		...DRAFT,
		main_story: { ...DRAFT.main_story, body: "First.\r\n\r\nSecond." },
	};
	const edited = {
		...draft,
		main_story: { ...draft.main_story, body: "First. Second." },
	};

	expect(diagnosticCodes(JSON.stringify(edited), draft)).toContain("paragraph_count");
});

test.each([
	["CR-only", "First.\r\rSecond."],
	["mixed LF and CR", "First.\n\rSecond."],
	["Unicode paragraph separator", "First.\u2029Second."],
	["Unicode line-separator pair", "First.\u2028\u2028Second."],
	["Unicode next-line pair", "First.\u0085\u0085Second."],
	["whitespace-only blank line", "First.\n \t\nSecond."],
	["NBSP-only blank line", "First.\n\u00A0\nSecond."],
] as const)("copyedit reports removal of a %s paragraph separator", (_label, body) => {
	const draft = {
		...DRAFT,
		main_story: { ...DRAFT.main_story, body },
	};
	const edited = {
		...draft,
		main_story: { ...draft.main_story, body: "First. Second." },
	};

	expect(diagnosticCodes(JSON.stringify(edited), draft)).toContain("paragraph_count");
});

test.each([
	["Unicode minus sign", "−230"],
	["fullwidth plus sign", "＋230"],
] as const)("copyedit reports removal of a %s from a numeric literal", (_label, numericLiteral) => {
	const draft = {
		...DRAFT,
		main_story: {
			...DRAFT.main_story,
			body: DRAFT.main_story.body.replace("230", numericLiteral),
		},
	};
	const edited = {
		...draft,
		main_story: {
			...draft.main_story,
			body: draft.main_story.body.replace(numericLiteral, "230"),
		},
	};

	expect(diagnosticCodes(JSON.stringify(edited), draft)).toContain("numeric_literal");
});

test.each([
	["Arabic-Indic numeric literal", "٢٣٠", "٢٣١"],
	["leading decimal numeric literal", ".5", "5"],
	["narrow-NBSP grouped numeric literal", "1\u202F234", "1/234"],
	["curly-apostrophe grouped numeric literal", "1’234", "1/234"],
	["time numeric literal", "12:30", "12/30"],
	["Arabic decimal numeric literal", "١٢٫٥", "١٢.٥"],
	["Arabic grouped numeric literal", "١٬٢٣٤", "١٢٣٤"],
] as const)("copyedit reports changing a %s", (_label, before, after) => {
	const draft = {
		...DRAFT,
		main_story: {
			...DRAFT.main_story,
			body: DRAFT.main_story.body.replace("230", before),
		},
	};
	const edited = {
		...draft,
		main_story: {
			...draft.main_story,
			body: draft.main_story.body.replace(before, after),
		},
	};

	expect(diagnosticCodes(JSON.stringify(edited), draft)).toContain("numeric_literal");
});

test("copyedit reports changing a guillemet-quoted span", () => {
	const draft = {
		...DRAFT,
		main_story: {
			...DRAFT.main_story,
			lede: "The region called it «a rough road» before regrouping.",
		},
	};
	const edited = {
		...draft,
		main_story: {
			...draft.main_story,
			lede: "The region called it «an easy road» before regrouping.",
		},
	};

	expect(diagnosticCodes(JSON.stringify(edited), draft)).toContain("quoted_span");
});

test.each([
	["ASCII single", "'a rough road'", "'an easy road'"],
	["English curly single", "‘a rough road’", "‘an easy road’"],
	["English curly single containing a possessive", "‘Aryn’s route’", "‘Aryn’s path’"],
	["German low/high single", "‚a rough road‘", "‚an easy road‘"],
	["reversed-high/right single", "‛a rough road’", "‛an easy road’"],
] as const)("copyedit reports changing a %s quoted span", (_label, before, after) => {
	const draft = {
		...DRAFT,
		main_story: {
			...DRAFT.main_story,
			lede: `The region called it ${before} before regrouping.`,
		},
	};
	const edited = {
		...draft,
		main_story: {
			...draft.main_story,
			lede: `The region called it ${after} before regrouping.`,
		},
	};

	expect(diagnosticCodes(JSON.stringify(edited), draft)).toContain("quoted_span");
});

test("copyedit does not treat contractions, possessives, or grouped-number apostrophes as quote delimiters", () => {
	const draft = {
		...DRAFT,
		main_story: {
			...DRAFT.main_story,
			lede: "Builders don't question Aryn's count of 1'234, and traders don’t question Aryn’s count of 1’234.",
		},
	};
	const edited = {
		...draft,
		main_story: {
			...draft.main_story,
			lede: "Builders don't dispute Aryn's count of 1'234, and traders don’t dispute Aryn’s count of 1’234.",
		},
	};

	expect(parseMainStoryCopyeditOutput(JSON.stringify(edited))).toEqual(edited);
	expect(diagnosticCodes(JSON.stringify(edited), draft)).toEqual([]);
});

test("copyedit reports changing an underscore-bold span", () => {
	const draft = {
		...DRAFT,
		main_story: {
			...DRAFT.main_story,
			body: DRAFT.main_story.body.replace("**KitServal**", "__KitServal__"),
		},
	};
	const edited = {
		...draft,
		main_story: {
			...draft.main_story,
			body: draft.main_story.body.replace("__KitServal__", "__Kit__"),
		},
	};

	expect(diagnosticCodes(JSON.stringify(edited), draft)).toContain("protected_markdown");
});

test("writer rejects fenced output instead of coercing it", () => {
	const fenced = `\`\`\`json\n${JSON.stringify(DRAFT)}\n\`\`\``;

	expect(() => parseMainStoryWriterOutput(fenced)).toThrow(EditorialOutputContractError);
});

test("writer classifies null content as a strict contract mismatch", () => {
	const failure = (() => {
		try {
			parseMainStoryWriterOutput(null);
		} catch (error: unknown) {
			return error;
		}
		return undefined;
	})();
	expect(failure).toMatchObject({
		name: "EditorialOutputContractError",
		productionStep: "main_story_write",
		code: "contract_mismatch",
	});
});

test("copyedit retains multiple preservation categories in deterministic order", () => {
	const edited = {
		...DRAFT,
		main_story: {
			...DRAFT.main_story,
			body: "Kit reported 231 lost shipments while builders compared routes. The group called the northern path \"an easy road\" and kept planning.",
		},
	};
	const result = parseMainStoryCopyeditOutputWithDiagnostics(JSON.stringify(edited), DRAFT);

	expect(result.product).toEqual(edited);
	expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
		"paragraph_count",
		"quoted_span",
		"numeric_literal",
		"protected_markdown",
	]);
	for (const diagnostic of result.diagnostics) {
		expect(EditorialDiagnosticSchema.safeParse(diagnostic).success).toBe(true);
	}
});

test("copyedit malformed JSON and strict schema mismatch remain terminal", () => {
	expect(() => parseMainStoryCopyeditOutput("not json")).toThrow(EditorialOutputContractError);
	expect(() => parseMainStoryCopyeditOutput(JSON.stringify({ ...DRAFT, invented: true }))).toThrow(
		EditorialOutputContractError,
	);
});

test("copyedit reports the optional image shape and protected URL without rejecting", () => {
	const draft = {
		...DRAFT,
		main_story: {
			...DRAFT.main_story,
			image: {
				url: "https://example.test/bridge.png",
				caption: "A bridge with 12 spans",
				credit: "**KitServal**",
			},
		},
	};

	expect(parseMainStoryCopyeditOutput(JSON.stringify(DRAFT))).toEqual(DRAFT);
	expect(diagnosticCodes(JSON.stringify(DRAFT), draft)).toEqual(["field_shape"]);
	const changedUrl = {
		...draft,
		main_story: {
			...draft.main_story,
			image: { ...draft.main_story.image, url: "https://example.test/other.png" },
		},
	};
	expect(parseMainStoryCopyeditOutput(JSON.stringify(changedUrl))).toEqual(changedUrl);
	expect(diagnosticCodes(JSON.stringify(changedUrl), draft)).toEqual(["protected_value"]);
});
