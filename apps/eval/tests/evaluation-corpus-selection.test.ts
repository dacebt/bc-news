import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import {
	derivePublicationDateForEvidenceDate,
	ProductionCorpusSelectionSchema,
	loadProductionCorpusSelection,
	type ProductionCorpusSelection,
} from "../src/evaluation-corpus-selection";

const selectionPath = fileURLToPath(new URL("../production-corpus-selection.json", import.meta.url));

async function readSelection(): Promise<ProductionCorpusSelection> {
	return (await loadProductionCorpusSelection(selectionPath)).selection;
}

test("production corpus selection freezes the six declared cases and exact totals", async () => {
	const loaded = await loadProductionCorpusSelection(selectionPath);
	const fileBytes = await readFile(selectionPath);
	const rawTotal = loaded.selection.cases.reduce((sum: number, entry) => sum + entry.expected_raw_count, 0);
	const preparedTotal = loaded.selection.cases.reduce((sum: number, entry) => sum + entry.expected_prepared_count, 0);

	expect(Buffer.from(loaded.bytes)).toEqual(fileBytes);
	expect(loaded.selection.cases).toHaveLength(6);
	expect(rawTotal).toBe(385);
	expect(preparedTotal).toBe(149);
	expect(loaded.selection.cases[1]).toMatchObject({
		ordinal: 2,
		id: "market-pressure-throughline",
		active_region_id: "14",
		expected_raw_count: 97,
		expected_prepared_count: 39,
	});
	expect(loaded.selection.cases[1]!.windows).toEqual([
		{
			start_utc: "2026-08-16T13:43:26.000Z",
			end_utc: "2026-08-16T14:22:53.001Z",
		},
		{
			start_utc: "2026-08-16T18:54:00.000Z",
			end_utc: "2026-08-16T18:59:29.001Z",
		},
	]);
});

test("selection schema rejects unknown selector fields", async () => {
	const selection = await readSelection();
	const parsed = ProductionCorpusSelectionSchema.safeParse({
		...selection,
		cases: selection.cases.map((entry, index) => index === 0
			? {
				...entry,
				windows: entry.windows.map((window, windowIndex) => windowIndex === 0
					? { ...window, message_ids: ["m-1"] }
					: window),
			}
			: entry),
	});

	expect(parsed.success).toBe(false);
});

test("selection schema rejects non-canonical and out-of-day timestamps", async () => {
	const selection = await readSelection();
	const nonCanonical = ProductionCorpusSelectionSchema.safeParse({
		...selection,
		cases: selection.cases.map((entry, index) => index === 0
			? {
				...entry,
				windows: [{ ...entry.windows[0], start_utc: "2026-08-16T09:32:39Z" }],
			}
			: entry),
	});
	const outsideDay = ProductionCorpusSelectionSchema.safeParse({
		...selection,
		cases: selection.cases.map((entry, index) => index === 0
			? {
				...entry,
				windows: [{ ...entry.windows[0], end_utc: "2026-08-17T00:00:00.001Z" }],
			}
			: entry),
	});

	expect(nonCanonical.success).toBe(false);
	expect(outsideDay.success).toBe(false);
});

test("selection schema rejects overlapping same-region windows across cases", async () => {
	const selection = await readSelection();
	const parsed = ProductionCorpusSelectionSchema.safeParse({
		...selection,
		cases: selection.cases.map((entry, index) => index === 4
			? {
				...entry,
				windows: [{ ...entry.windows[0], start_utc: "2026-08-16T01:03:56.000Z" }],
			}
			: entry),
	});

	expect(parsed.success).toBe(false);
});

test("selection schema rejects duplicate ids, noncontiguous ordinals, and inactive regions", async () => {
	const selection = await readSelection();
	const parsed = ProductionCorpusSelectionSchema.safeParse({
		...selection,
		cases: selection.cases.map((entry, index) => {
			if (index === 1) return { ...entry, id: "dense-new-player-progression" };
			if (index === 2) return { ...entry, ordinal: 4 };
			if (index === 3) return { ...entry, active_region_id: "99" };
			return entry;
		}),
	});

	expect(parsed.success).toBe(false);
});

test("derives the canonical publication date from an evidence day and rejects non-round-tripping days", () => {
	expect(derivePublicationDateForEvidenceDate("2026-08-16")).toBe("2026-08-17");
	expect(() => derivePublicationDateForEvidenceDate("2026-02-30")).toThrow(
		"Cannot derive the canonical publication date for evidence day 2026-02-30",
	);
});
