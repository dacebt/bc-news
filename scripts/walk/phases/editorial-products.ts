import { EditionSchema, MainStorySchema, type MainStory } from "@bc-news/contracts";
import type { WalkContext, WalkPhase } from "../phase";
import { readRecordedResponse } from "../recorded-response";

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
	subtitle: string;
	main_story: MainStory;
}

function parseRecordedMainStoryProduct(text: string): RecordedMainStoryProduct {
	const value = JSON.parse(text) as unknown;
	if (
		!isRecord(value) ||
		!hasExactKeys(value, ["title", "subtitle", "main_story"]) ||
		typeof value.title !== "string" ||
		typeof value.subtitle !== "string"
	) {
		throw new Error("main_story_copyedit recorded response has an invalid final product");
	}
	return {
		title: value.title,
		subtitle: value.subtitle,
		main_story: MainStorySchema.parse(value.main_story),
	};
}

interface RecordedAnnouncement {
	id: string;
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
				!hasExactKeys(announcement, ["id", "title", "summary"]) ||
				typeof announcement.id !== "string" ||
				typeof announcement.title !== "string" ||
				typeof announcement.summary !== "string",
		)
	) {
		throw new Error("announcements_copyedit recorded response has invalid identified announcements");
	}
	return value.announcements as RecordedAnnouncement[];
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
		throw new Error("published announcements must be objects with no internal copyedit ids");
	}
	const mainStory = parseRecordedMainStoryProduct(
		(await readRecordedResponse("main_story_copyedit")).text,
	);
	const identifiedAnnouncements = parseRecordedAnnouncements(
		(await readRecordedResponse("announcements_copyedit")).text,
	);
	const announcements = identifiedAnnouncements.map(({ title, summary }) => ({
		title,
		summary,
	}));

	if (
		edition.title !== mainStory.title ||
		edition.subtitle !== mainStory.subtitle ||
		JSON.stringify(edition.main_story) !== JSON.stringify(mainStory.main_story) ||
		JSON.stringify(edition.announcements) !== JSON.stringify(announcements)
	) {
		throw new Error(
			"published edition does not match the two recorded copyedited editorial products",
		);
	}
	if (ctx.state.firstModelUsageBody === undefined) {
		throw new Error("editorial-products phase requires operator-status usage evidence");
	}
	const usages = JSON.parse(ctx.state.firstModelUsageBody) as {
		production_step: string;
		provider: string;
		model: string;
	}[];
	const usageByStep = new Map(usages.map((usage) => [usage.production_step, usage]));
	const provenanceFor = (productionStep: string): { provider: string; model: string } => {
		const usage = usageByStep.get(productionStep);
		if (usage === undefined) {
			throw new Error(`missing ${productionStep} usage needed to verify edition provenance`);
		}
		return { provider: usage.provider, model: usage.model };
	};
	const expectedProvenance = {
		main_story: {
			write: provenanceFor("main_story_write"),
			copyedit: provenanceFor("main_story_copyedit"),
		},
		announcements: {
			write: provenanceFor("announcements_write"),
			copyedit: provenanceFor("announcements_copyedit"),
		},
	};
	const actualProvenance = edition.meta.editorial_products;
	if (
		actualProvenance.main_story.write.provider !==
			expectedProvenance.main_story.write.provider ||
		actualProvenance.main_story.write.model !== expectedProvenance.main_story.write.model ||
		actualProvenance.main_story.copyedit.provider !==
			expectedProvenance.main_story.copyedit.provider ||
		actualProvenance.main_story.copyedit.model !==
			expectedProvenance.main_story.copyedit.model ||
		actualProvenance.announcements.write.provider !==
			expectedProvenance.announcements.write.provider ||
		actualProvenance.announcements.write.model !==
			expectedProvenance.announcements.write.model ||
		actualProvenance.announcements.copyedit.provider !==
			expectedProvenance.announcements.copyedit.provider ||
		actualProvenance.announcements.copyedit.model !==
			expectedProvenance.announcements.copyedit.model
	) {
		throw new Error(
			`edition provenance was not derived from the four production usages: ${JSON.stringify(actualProvenance)}`,
		);
	}

	console.log(
		"walk: deterministic assembly published both copyedited products with usage-derived provenance and no internal announcement ids",
	);
}

export const walkPhase: WalkPhase = { name: "editorial-products", run };
