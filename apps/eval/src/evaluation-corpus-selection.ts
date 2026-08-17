import { readFile } from "node:fs/promises";
import { ACTIVE_REGION_IDS, ActiveRegionIdSchema } from "@bc-news/contracts";
import { evidenceDateForPublicationDate } from "@bc-news/generation-core";
import { z } from "zod";

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const CANONICAL_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const ACTIVE_REGION_ID_SET = new Set(ACTIVE_REGION_IDS);

const CorpusIdSchema = z.string().regex(KEBAB_CASE);
const SnapshotSha256Schema = z.string().regex(SHA256);
const CanonicalUtcTimestampSchema = z.string().regex(CANONICAL_UTC_TIMESTAMP).refine((value) => {
	const time = Date.parse(value);
	return Number.isFinite(time) && new Date(time).toISOString() === value;
}, "Timestamp must be canonical UTC ISO-8601 with millisecond precision");
const ProductionCorpusSelectionWindowSchema = z.strictObject({
	start_utc: CanonicalUtcTimestampSchema,
	end_utc: CanonicalUtcTimestampSchema,
}).superRefine((window, context) => {
	if (Date.parse(window.start_utc) >= Date.parse(window.end_utc)) {
		context.addIssue({
			code: "custom",
			path: ["end_utc"],
			message: "Window end must be after start",
		});
	}
});

const ActiveSelectionRegionIdSchema = ActiveRegionIdSchema.refine(
	(value: string) => ACTIVE_REGION_ID_SET.has(value),
	"Active region id must be one of the configured active regions",
);

const ProductionCorpusSelectionCaseSchema = z.strictObject({
	ordinal: z.number().int().positive(),
	id: CorpusIdSchema,
	active_region_id: ActiveSelectionRegionIdSchema,
	windows: z.tuple([ProductionCorpusSelectionWindowSchema]).rest(ProductionCorpusSelectionWindowSchema),
	expected_raw_count: z.number().int().positive(),
	expected_prepared_count: z.number().int().positive(),
}).superRefine((entry, context) => {
	let previousEnd: number | null = null;
	for (const [index, window] of entry.windows.entries()) {
		const start = Date.parse(window.start_utc);
		if (previousEnd !== null && start < previousEnd) {
			context.addIssue({
				code: "custom",
				path: ["windows", index, "start_utc"],
				message: "Case windows must be ordered and non-overlapping",
			});
		}
		previousEnd = Date.parse(window.end_utc);
	}
});

function dayBounds(evidenceDate: string): { readonly start: number; readonly end: number } {
	const start = Date.parse(`${evidenceDate}T00:00:00.000Z`);
	return { start, end: start + 86_400_000 };
}

export function derivePublicationDateForEvidenceDate(evidenceDate: string): string {
	const [year, month, day] = evidenceDate.split("-").map(Number);
	const shifted = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + 1));
	const candidate = [
		shifted.getUTCFullYear().toString().padStart(4, "0"),
		(shifted.getUTCMonth() + 1).toString().padStart(2, "0"),
		shifted.getUTCDate().toString().padStart(2, "0"),
	].join("-");
	if (evidenceDateForPublicationDate(candidate) !== evidenceDate) {
		throw new Error(`Cannot derive the canonical publication date for evidence day ${evidenceDate}`);
	}
	return candidate;
}

function validateEvidenceDay(
	selection: {
		readonly evidence_date: string;
		readonly cases: readonly z.infer<typeof ProductionCorpusSelectionCaseSchema>[];
	},
	context: z.RefinementCtx,
): void {
	const bounds = dayBounds(selection.evidence_date);
	for (const [caseIndex, entry] of selection.cases.entries()) {
		for (const [windowIndex, window] of entry.windows.entries()) {
			const start = Date.parse(window.start_utc);
			const end = Date.parse(window.end_utc);
			if (start < bounds.start || start >= bounds.end) {
				context.addIssue({
					code: "custom",
					path: ["cases", caseIndex, "windows", windowIndex, "start_utc"],
					message: "Window start must fall inside the evidence day",
				});
			}
			if (end <= bounds.start || end > bounds.end) {
				context.addIssue({
					code: "custom",
					path: ["cases", caseIndex, "windows", windowIndex, "end_utc"],
					message: "Window end must fall inside the evidence day boundary",
				});
			}
		}
	}
}

function validateCaseIdentity(
	cases: readonly z.infer<typeof ProductionCorpusSelectionCaseSchema>[],
	context: z.RefinementCtx,
): void {
	const ids = new Set<string>();
	for (const [index, entry] of cases.entries()) {
		if (entry.ordinal !== index + 1) {
			context.addIssue({
				code: "custom",
				path: ["cases", index, "ordinal"],
				message: "Case ordinals must be contiguous and start at 1",
			});
		}
		if (ids.has(entry.id)) {
			context.addIssue({
				code: "custom",
				path: ["cases", index, "id"],
				message: "Case ids must be unique",
			});
		}
		ids.add(entry.id);
	}
}

function validateCrossCaseWindows(
	cases: readonly z.infer<typeof ProductionCorpusSelectionCaseSchema>[],
	context: z.RefinementCtx,
): void {
	const latestEndByRegion = new Map<string, { readonly caseIndex: number; readonly end: number }>();
	for (const [caseIndex, entry] of cases.entries()) {
		for (const [windowIndex, window] of entry.windows.entries()) {
			const start = Date.parse(window.start_utc);
			const end = Date.parse(window.end_utc);
			const previous = latestEndByRegion.get(entry.active_region_id);
			if (previous !== undefined && start < previous.end) {
				context.addIssue({
					code: "custom",
					path: ["cases", caseIndex, "windows", windowIndex, "start_utc"],
					message: "Same-region windows must remain ordered and non-overlapping across cases",
				});
			}
			latestEndByRegion.set(entry.active_region_id, { caseIndex, end });
		}
	}
}

export const ProductionCorpusSelectionSchema = z.strictObject({
	version: z.literal(1),
	id: CorpusIdSchema,
	snapshot_sha256: SnapshotSha256Schema,
	evidence_date: z.iso.date(),
	cases: z.tuple([ProductionCorpusSelectionCaseSchema]).rest(ProductionCorpusSelectionCaseSchema),
}).superRefine((selection, context) => {
	validateEvidenceDay(selection, context);
	validateCaseIdentity(selection.cases, context);
	validateCrossCaseWindows(selection.cases, context);
});

export type ProductionCorpusSelection = z.infer<typeof ProductionCorpusSelectionSchema>;

export interface LoadedProductionCorpusSelection {
	readonly selection: ProductionCorpusSelection;
	readonly bytes: Uint8Array;
}

type ProductionCorpusSelectionErrorCode =
	| "selection_unreadable"
	| "selection_malformed"
	| "selection_rejected";

export class ProductionCorpusSelectionError extends Error {
	readonly code: ProductionCorpusSelectionErrorCode;
	readonly path: string;

	constructor(code: ProductionCorpusSelectionErrorCode, path: string, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "ProductionCorpusSelectionError";
		this.code = code;
		this.path = path;
	}
}

export async function loadProductionCorpusSelection(path: string): Promise<LoadedProductionCorpusSelection> {
	let bytes: Uint8Array;
	try {
		bytes = await readFile(path);
	} catch (cause) {
		throw new ProductionCorpusSelectionError("selection_unreadable", path, `Cannot read production corpus selection: ${path}`, { cause });
	}

	let candidate: unknown;
	try {
		candidate = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
	} catch (cause) {
		throw new ProductionCorpusSelectionError("selection_malformed", path, `Malformed production corpus selection JSON: ${path}`, { cause });
	}

	const parsed = ProductionCorpusSelectionSchema.safeParse(candidate);
	if (!parsed.success) {
		throw new ProductionCorpusSelectionError("selection_rejected", path, `Production corpus selection contract rejected ${path}: ${parsed.error.message}`, { cause: parsed.error });
	}

	return { selection: parsed.data, bytes };
}
