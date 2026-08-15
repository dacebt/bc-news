import { expect, test } from "vitest";
import {
	EditorialOutputContractError,
	attachAnnouncementIds,
	buildAnnouncementsCopyeditPrompt,
	buildAnnouncementsWriterPrompt,
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

function evidence() {
	return {
		active_region_id: "7",
		publication_date: "2026-01-25",
		raw_count: 0,
		after_filter_count: 0,
		after_burst_count: 0,
		final_count: 0,
		drop_stats: { empty_after_trim: 0, too_short: 0, burst_merged: 0, sampling_dropped: 0 },
		messages: [],
	};
}

test("writer contract describes announcement fields without copyable placeholder values", () => {
	const prompt = buildAnnouncementsWriterPrompt(evidence());

	expect(prompt).toContain("Extract every noteworthy achievement and milestone");
	expect(prompt).toContain("Treat skill grinding as ordinary economic activity");
	expect(prompt).toContain("Do not rank announcements or select only the most prominent");
	expect(prompt).toContain("announcements (array): zero or more noteworthy achievements");
	expect(prompt).toContain("title (string): a brief plain-text achievement headline");
	expect(prompt).not.toContain("explicit achievement by a named person");
	expect(prompt).not.toContain("Brief achievement headline, plain text");
	expect(prompt).not.toContain("What was accomplished, with markdown only");
});

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

test("copyedit prompt exposes draft ids but no evidence or other editorial product", () => {
	const prompt = buildAnnouncementsCopyeditPrompt(attachAnnouncementIds(DRAFT));

	expect(prompt).toContain("announcement-1");
	expect(prompt).toContain("[UNTRUSTED ANNOUNCEMENTS DRAFT DATA]");
	expect(prompt).not.toContain("[UNTRUSTED CHAT MESSAGE DATA]");
	expect(prompt).not.toContain("Region:");
	expect(prompt).not.toContain("Date:");
	expect(prompt).not.toContain("main_story");
	expect(prompt).not.toContain("score");
	expect(prompt).not.toContain("verdict");
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
