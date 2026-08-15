import { expect, test } from "vitest";
import {
	EditorialOutputContractError,
	attachAnnouncementIds,
	parseAnnouncementsCopyeditOutput,
	parseAnnouncementsCopyeditOutputWithDiagnostics,
	parseAnnouncementsWriterOutput,
} from "../src/index";

const DRAFT = {
	announcements: [
		{
			title: "KitServal Reaches Level 50",
			summary: "**KitServal** reached level 50 in *Fishing* and called it \"a long haul\".",
		},
		{
			title: "Builders Complete 12 Towers",
			summary: "**Mira** and **Sol** completed 12 towers.\n\nThe final tower opened at dawn.",
		},
	],
};

test("attaches stable internal ids and strips them from the accepted public product", () => {
	const identified = attachAnnouncementIds(DRAFT);
	const edited = {
		announcements: identified.announcements.map((announcement, index) => ({
			...announcement,
			summary: index === 0
				? "**KitServal** reached level 50 in *Fishing*, calling it \"a long haul\"."
				: "**Mira** and **Sol** completed 12 towers.\n\nThe last tower opened at dawn.",
		})),
	};

	expect(identified.announcements.map(({ id }) => id)).toEqual([
		"announcement-1",
		"announcement-2",
	]);
	expect(parseAnnouncementsCopyeditOutput(JSON.stringify(edited))).toEqual({
		announcements: edited.announcements.map(({ title, summary }) => ({ title, summary })),
	});
	expect(parseAnnouncementsCopyeditOutputWithDiagnostics(JSON.stringify(edited), identified).diagnostics).toEqual([]);
});

test("copyedit reports swapped announcement identities and still returns the product", () => {
	const identified = attachAnnouncementIds(DRAFT);
	const swapped = {
		announcements: [identified.announcements[1]!, identified.announcements[0]!],
	};

	const result = parseAnnouncementsCopyeditOutputWithDiagnostics(JSON.stringify(swapped), identified);
	expect(result.product.announcements).toEqual(
		swapped.announcements.map(({ title, summary }) => ({ title, summary })),
	);
	expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
		"announcement_identity",
		"numeric_literal",
		"paragraph_count",
		"quoted_span",
		"numeric_literal",
		"protected_markdown",
		"announcement_identity",
		"numeric_literal",
		"paragraph_count",
		"quoted_span",
		"numeric_literal",
		"protected_markdown",
	]);
});

test.each([
	["numeric literal", "**KitServal** reached level 51 in *Fishing* and called it \"a long haul\".", "numeric_literal"],
	["quoted span", "**KitServal** reached level 50 in *Fishing* and called it \"an easy run\".", "quoted_span"],
	["bold span", "**Kit** reached level 50 in *Fishing* and called it \"a long haul\".", "protected_markdown"],
	["italic span", "**KitServal** reached level 50 in *Hunting* and called it \"a long haul\".", "protected_markdown"],
] as const)("copyedit reports changed %s without rejecting", (_label, summary, code) => {
	const identified = attachAnnouncementIds(DRAFT);
	const edited = {
		announcements: [
			{ ...identified.announcements[0]!, summary },
			identified.announcements[1]!,
		],
	};

	const result = parseAnnouncementsCopyeditOutputWithDiagnostics(JSON.stringify(edited), identified);
	expect(result.product.announcements).toHaveLength(2);
	expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(code);
});

test("copyedit reports count changes and malformed output remains terminal", () => {
	const identified = attachAnnouncementIds(DRAFT);
	const shortened = { announcements: [identified.announcements[0]] };
	const result = parseAnnouncementsCopyeditOutputWithDiagnostics(JSON.stringify(shortened), identified);
	expect(result.product.announcements).toHaveLength(1);
	expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["announcement_count"]);
	expect(() => parseAnnouncementsCopyeditOutput("not json")).toThrow(EditorialOutputContractError);
});

test("writer keeps an empty announcement product valid", () => {
	expect(parseAnnouncementsWriterOutput('{"announcements":[]}')).toEqual({ announcements: [] });
});

test("writer classifies null content as a strict contract mismatch", () => {
	const failure = (() => {
		try {
			parseAnnouncementsWriterOutput(null);
		} catch (error: unknown) {
			return error;
		}
		return undefined;
	})();
	expect(failure).toMatchObject({
		name: "EditorialOutputContractError",
		productionStep: "announcements_write",
		code: "contract_mismatch",
	});
});
