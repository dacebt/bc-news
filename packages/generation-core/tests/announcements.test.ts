import { expect, test } from "vitest";
import {
	CopyeditPreservationError,
	attachAnnouncementIds,
	buildAnnouncementsCopyeditPrompt,
	parseAnnouncementsCopyeditOutput,
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
	expect(parseAnnouncementsCopyeditOutput(JSON.stringify(edited), identified)).toEqual({
		announcements: edited.announcements.map(({ title, summary }) => ({ title, summary })),
	});
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

test("copyedit rejects swapped announcement identities even when count is unchanged", () => {
	const identified = attachAnnouncementIds(DRAFT);
	const swapped = {
		announcements: [identified.announcements[1], identified.announcements[0]],
	};

	try {
		parseAnnouncementsCopyeditOutput(JSON.stringify(swapped), identified);
		expect.unreachable("identity check should have rejected reordered announcements");
	} catch (error) {
		expect(error).toBeInstanceOf(CopyeditPreservationError);
		expect((error as CopyeditPreservationError).code).toBe("announcement_identity");
	}
});

test.each([
	["numeric literal", "**KitServal** reached level 51 in *Fishing* and called it \"a long haul\".", "numeric_literal"],
	["quoted span", "**KitServal** reached level 50 in *Fishing* and called it \"an easy run\".", "quoted_span"],
	["bold span", "**Kit** reached level 50 in *Fishing* and called it \"a long haul\".", "protected_markdown"],
	["italic span", "**KitServal** reached level 50 in *Hunting* and called it \"a long haul\".", "protected_markdown"],
] as const)("copyedit rejects changed %s", (_label, summary, code) => {
	const identified = attachAnnouncementIds(DRAFT);
	const edited = {
		announcements: [
			{ ...identified.announcements[0]!, summary },
			identified.announcements[1]!,
		],
	};

	try {
		parseAnnouncementsCopyeditOutput(JSON.stringify(edited), identified);
		expect.unreachable("preservation check should have rejected the edit");
	} catch (error) {
		expect(error).toBeInstanceOf(CopyeditPreservationError);
		expect((error as CopyeditPreservationError).code).toBe(code);
	}
});

test("writer keeps an empty announcement product valid", () => {
	expect(parseAnnouncementsWriterOutput('{"announcements":[]}')).toEqual({ announcements: [] });
});
