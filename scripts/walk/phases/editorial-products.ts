import { EditionSchema, MainStorySchema, type MainStory } from "@bc-news/contracts";
import type { WalkModelUsageRecord } from "../generation-run-status";
import type { WalkContext, WalkPhase } from "../phase";
import { readRecordedResponse } from "../recorded-response-reader";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	return (
		Object.keys(value).length === keys.length &&
		keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
	);
}

interface RecordedMainStoryProduct {
	title: string;
	main_story: MainStory;
}

function parseRecordedMainStoryProduct(text: string): RecordedMainStoryProduct {
	const value = JSON.parse(text) as unknown;
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ["title", "main_story"]) ||
		typeof value.title !== "string"
	) {
		throw new Error("main_story_write recorded response has an invalid final product");
	}
	return {
		title: value.title,
		main_story: MainStorySchema.parse(value.main_story),
	};
}

interface RecordedAnnouncement {
	title: string;
	summary: string;
}

function parseRecordedAnnouncements(text: string): readonly RecordedAnnouncement[] {
	const value = JSON.parse(text) as unknown;
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ["announcements"]) ||
		!Array.isArray(value.announcements) ||
		value.announcements.some(
			(announcement) =>
				!isRecord(announcement) ||
				!hasExactKeys(announcement, ["title", "summary"]) ||
				typeof announcement.title !== "string" ||
				typeof announcement.summary !== "string",
		)
	) {
		throw new Error("announcements_write recorded response has invalid final announcements");
	}
	return value.announcements as RecordedAnnouncement[];
}

interface WriterProvenance {
	provider: string;
	model: string;
}

function parseWriterProvenance(value: unknown): WriterProvenance {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ["provider", "model"]) ||
		typeof value.provider !== "string" ||
		value.provider.length === 0 ||
		typeof value.model !== "string" ||
		value.model.length === 0
	) {
		throw new Error("published edition has invalid writer provenance");
	}
	return { provider: value.provider, model: value.model };
}

function parseLegacyWriterProvenance(value: unknown): WriterProvenance {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ["write", "copyedit"])
	) {
		throw new Error("published edition has invalid writer provenance");
	}
	parseWriterProvenance(value.copyedit);
	return parseWriterProvenance(value.write);
}

export function extractWriterProvenance(
	edition: unknown,
	productKey: "main_story" | "announcements",
): WriterProvenance {
	if (
		!isRecord(edition) ||
		!isRecord(edition.meta) ||
		!isRecord(edition.meta.editorial_products) ||
		!isRecord(edition.meta.editorial_products[productKey])
	) {
		throw new Error("published edition is missing editorial product provenance");
	}
	const productProvenance = edition.meta.editorial_products[productKey];
	try {
		return parseWriterProvenance(productProvenance);
	} catch (error) {
		if (!(error instanceof Error)) {
			throw error;
		}
	}
	return parseLegacyWriterProvenance(productProvenance);
}

async function run(ctx: WalkContext): Promise<void> {
	if (ctx.state.firstServedEditionBody === undefined) {
		throw new Error(
			"editorial-products phase requires the published edition from publish-poll",
		);
	}
	const unparsedEdition = JSON.parse(ctx.state.firstServedEditionBody) as unknown;
	const edition = EditionSchema.parse(unparsedEdition);
	if (
		typeof unparsedEdition !== "object" ||
		unparsedEdition === null ||
		!("announcements" in unparsedEdition) ||
		!Array.isArray(unparsedEdition.announcements) ||
		unparsedEdition.announcements.some(
			(announcement) =>
				typeof announcement !== "object" ||
				announcement === null ||
				"id" in announcement,
		)
	) {
		throw new Error("published announcements must be objects with no internal announcement ids");
	}
	const mainStory = parseRecordedMainStoryProduct(
		(await readRecordedResponse("main_story_write")).text,
	);
	const identifiedAnnouncements = parseRecordedAnnouncements(
		(await readRecordedResponse("announcements_write")).text,
	);

	if (
		edition.title !== mainStory.title ||
		JSON.stringify(edition.main_story) !== JSON.stringify(mainStory.main_story) ||
		JSON.stringify(edition.announcements) !== JSON.stringify(identifiedAnnouncements)
	) {
		throw new Error(
			"published edition does not match the two recorded writer editorial products",
		);
	}
	if (ctx.state.firstGenerationRunEvidence === undefined) {
		throw new Error("editorial-products phase requires operator-status usage evidence");
	}
	const usages = ctx.state.firstGenerationRunEvidence.model_usage;
	const usageByStep = new Map(usages.map((usage) => [usage.production_step, usage]));
	const provenanceFor = (
		productionStep: WalkModelUsageRecord["production_step"],
	): { provider: string; model: string } => {
		const usage = usageByStep.get(productionStep);
		if (usage === undefined) {
			throw new Error(`missing ${productionStep} usage needed to verify edition provenance`);
		}
		return { provider: usage.provider, model: usage.model };
	};
	const expectedProvenance = {
		main_story: {
			write: provenanceFor("main_story_write"),
		},
		announcements: {
			write: provenanceFor("announcements_write"),
		},
	};
	const actualProvenance = {
		main_story: extractWriterProvenance(unparsedEdition, "main_story"),
		announcements: extractWriterProvenance(unparsedEdition, "announcements"),
	};
	if (
		actualProvenance.main_story.provider !== expectedProvenance.main_story.write.provider ||
		actualProvenance.main_story.model !== expectedProvenance.main_story.write.model ||
		actualProvenance.announcements.provider !== expectedProvenance.announcements.write.provider ||
		actualProvenance.announcements.model !== expectedProvenance.announcements.write.model
	) {
		throw new Error(
			`edition provenance was not derived from the two writer usages: ${JSON.stringify(actualProvenance)}`,
		);
	}

	console.log(
		"walk: deterministic assembly published both writer products with writer-derived provenance and no internal announcement ids",
	);
}

export const walkPhase: WalkPhase = { name: "editorial-products", run };
