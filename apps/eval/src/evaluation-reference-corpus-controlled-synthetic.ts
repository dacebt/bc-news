import { type EvidenceFixture } from "@bc-news/contracts";
import {
	type EvaluationReference,
	type EvaluationReferenceManifest,
} from "./evaluation-reference-corpus";

type EvidenceMessage = EvidenceFixture["messages"][number];
type ReferenceWitness = EvaluationReference["claims"][number]["supporting_witnesses"][number];
type VariationWitness = EvaluationReferenceManifest["fixtures"][number]["variation_witnesses"][number];

export type ControlledReferenceCorpusFixtureDefinition = {
	readonly ordinal: number;
	readonly id: string;
	readonly evidence: EvidenceFixture;
	readonly reference: EvaluationReference;
	readonly variation_tags: EvaluationReferenceManifest["fixtures"][number]["variation_tags"];
	readonly variation_witnesses: EvaluationReferenceManifest["fixtures"][number]["variation_witnesses"];
};

const EVIDENCE_DATE = "2026-06-01";
const FIXTURE_START_TS = Date.parse("2026-06-01T09:00:00.000Z");
const MESSAGE_STEP_MS = 60_000;

function message(id: string, ordinal: number, author: string, text: string): EvidenceMessage {
	return { id, ts: FIXTURE_START_TS + (ordinal * MESSAGE_STEP_MS), author_id: `author/${author.toLowerCase()}`, author_name: author, text };
}

function textWitness(messageId: string, excerpt: string): ReferenceWitness {
	return { message_id: messageId, field: "text", excerpt };
}

function authorWitness(messageId: string, author: string): ReferenceWitness {
	return { message_id: messageId, field: "author_name", excerpt: author };
}

function variationWitness(tag: VariationWitness["tag"], referenceIds: readonly string[], messageIds: readonly string[]): VariationWitness {
	return { tag, reference_ids: [...referenceIds], message_ids: [...messageIds] };
}

function createFixture(
	ordinal: number,
	id: string,
	messages: readonly EvidenceMessage[],
	reference: EvaluationReference,
	variationTags: ControlledReferenceCorpusFixtureDefinition["variation_tags"],
	variationWitnesses: readonly VariationWitness[],
): ControlledReferenceCorpusFixtureDefinition {
	return {
		ordinal,
		id,
		evidence: { active_region_id: String(20 + ordinal), evidence_date: EVIDENCE_DATE, messages: [...messages] },
		reference,
		variation_tags: variationTags,
		variation_witnesses: variationWitnesses.map((witness) => ({ ...witness, reference_ids: [...witness.reference_ids], message_ids: [...witness.message_ids] })),
	};
}

function denseFixture(): ControlledReferenceCorpusFixtureDefinition {
	const messages = Array.from({ length: 24 }, (_, index) => ({
		id: `dense-${String(index + 1).padStart(2, "0")}`,
		ts: Date.parse(`2026-06-01T${String(index).padStart(2, "0")}:00:00.000Z`),
		author_id: `author/${["mara", "ivo", "niko", "sena"][index % 4]!}`,
		author_name: ["Mara", "Ivo", "Niko", "Sena"][index % 4]!,
		text: index === 9 ? "East Market opened at 09:00 UTC." : `Dense checkpoint ${index + 1} recorded for East Market lane ${index + 1}.`,
	}));
	return createFixture(1, "dense-market-day", messages, {
		version: 2,
		fixture_id: "dense-market-day",
		claims: [{ id: "market-opened", status: "established", supporting_witnesses: [textWitness("dense-10", "East Market opened at 09:00 UTC.")], opposing_witnesses: [], unresolved_witnesses: [] }],
		events: [],
		ambiguities: [],
		noteworthy_candidates: [],
		entities: [],
		numbers: [],
		event_relationships: [],
		irrelevant_message_ids: [],
	}, ["dense"], [variationWitness("dense", [], messages.map(({ id }) => id))]);
}

function sparseFixture(): ControlledReferenceCorpusFixtureDefinition {
	const messages = [
		message("repair-01", 31, "Tova", "Moss Bridge repairs finished at 11:00 UTC."),
		message("repair-02", 32, "Eli", "The crew replaced 6 oak planks."),
		message("repair-03", 33, "Tova", "Moss Bridge is open again."),
		message("repair-04", 34, "Eli", "Willow Camp received the reopen notice."),
	] as const;
	return createFixture(2, "sparse-repair-update", messages, {
		version: 2,
		fixture_id: "sparse-repair-update",
		claims: [],
		events: [{ id: "moss-bridge-repair", status: "established", supporting_witnesses: [textWitness("repair-01", "Moss Bridge repairs finished"), textWitness("repair-03", "Moss Bridge is open again.")], opposing_witnesses: [], unresolved_witnesses: [] }],
		ambiguities: [],
		noteworthy_candidates: [],
		entities: [],
		numbers: [],
		event_relationships: [],
		irrelevant_message_ids: [],
	}, ["sparse"], [variationWitness("sparse", [], messages.map(({ id }) => id))]);
}

function overlappingFixture(): ControlledReferenceCorpusFixtureDefinition {
	const messages = [
		message("overlap-01", 41, "Asha", "The grain cart reached River Depot."),
		message("overlap-02", 42, "Ben", "The timber wagon reached River Depot."),
		message("overlap-03", 43, "Asha", "Both crews are sharing the north ramp."),
	] as const;
	return createFixture(3, "overlapping-deliveries", messages, {
		version: 2,
		fixture_id: "overlapping-deliveries",
		claims: [],
		events: [
			{ id: "grain-cart-arrival", status: "established", supporting_witnesses: [textWitness("overlap-01", "grain cart reached River Depot")], opposing_witnesses: [], unresolved_witnesses: [] },
			{ id: "timber-wagon-arrival", status: "established", supporting_witnesses: [textWitness("overlap-02", "timber wagon reached River Depot")], opposing_witnesses: [], unresolved_witnesses: [] },
		],
		ambiguities: [],
		noteworthy_candidates: [],
		entities: [],
		numbers: [],
		event_relationships: [{ id: "deliveries-overlap", kind: "overlaps", event_ids: ["grain-cart-arrival", "timber-wagon-arrival"] }],
		irrelevant_message_ids: [],
	}, ["overlapping_events"], [variationWitness("overlapping_events", ["relationship:deliveries-overlap", "event:grain-cart-arrival", "event:timber-wagon-arrival"], ["overlap-01", "overlap-02"])]);
}

function isolatedFixture(): ControlledReferenceCorpusFixtureDefinition {
	const messages = [
		message("isolated-01", 51, "Pia", "South Watch relit the lone watchfire."),
		message("isolated-02", 52, "Pia", "No other patrol reports arrived this hour."),
	] as const;
	return createFixture(4, "isolated-watchfire", messages, {
		version: 2,
		fixture_id: "isolated-watchfire",
		claims: [],
		events: [{ id: "watchfire-relit", status: "established", supporting_witnesses: [textWitness("isolated-01", "relit the lone watchfire")], opposing_witnesses: [], unresolved_witnesses: [] }],
		ambiguities: [],
		noteworthy_candidates: [],
		entities: [],
		numbers: [],
		event_relationships: [{ id: "watchfire-isolated", kind: "isolated", event_ids: ["watchfire-relit"] }],
		irrelevant_message_ids: [],
	}, ["isolated_event"], [variationWitness("isolated_event", ["relationship:watchfire-isolated", "event:watchfire-relit"], ["isolated-01"])]);
}

function contradictionFixture(): ControlledReferenceCorpusFixtureDefinition {
	const messages = [
		message("toll-01", 61, "Dera", "Stone Gate toll is 8 copper today."),
		message("toll-02", 62, "Fenn", "The posted Stone Gate toll says 10 copper."),
		message("toll-03", 63, "Dera", "I paid 8 copper at sunrise."),
	] as const;
	return createFixture(5, "toll-dispute", messages, {
		version: 2,
		fixture_id: "toll-dispute",
		claims: [{ id: "stone-gate-toll", status: "contested", supporting_witnesses: [textWitness("toll-01", "8 copper today"), textWitness("toll-03", "paid 8 copper")], opposing_witnesses: [textWitness("toll-02", "10 copper")], unresolved_witnesses: [] }],
		events: [],
		ambiguities: [],
		noteworthy_candidates: [],
		entities: [],
		numbers: [],
		event_relationships: [],
		irrelevant_message_ids: [],
	}, ["contradiction"], [variationWitness("contradiction", ["claim:stone-gate-toll"], ["toll-01", "toll-02", "toll-03"])]);
}

function unresolvedFixture(): ControlledReferenceCorpusFixtureDefinition {
	const messages = [
		message("location-01", 71, "Gia", "Nell left the supply chest near the old tower."),
		message("location-02", 72, "Hale", "Do you mean the east tower or the flooded tower?"),
		message("location-03", 73, "Gia", "Nell never said which old tower."),
	] as const;
	return createFixture(6, "unresolved-location", messages, {
		version: 2,
		fixture_id: "unresolved-location",
		claims: [],
		events: [],
		ambiguities: [{ id: "old-tower-identity", witnesses: [textWitness("location-01", "old tower"), textWitness("location-02", "east tower or the flooded tower"), textWitness("location-03", "which old tower")] }],
		noteworthy_candidates: [],
		entities: [],
		numbers: [],
		event_relationships: [],
		irrelevant_message_ids: [],
	}, ["unresolved_ambiguity"], [variationWitness("unresolved_ambiguity", ["ambiguity:old-tower-identity"], ["location-01", "location-02", "location-03"])]);
}

function announcementFixture(): ControlledReferenceCorpusFixtureDefinition {
	const messages = [
		message("announce-01", 81, "Rhea", "Harbor bell notice: ferry boarding begins at noon."),
		message("announce-02", 82, "Rhea", "The clerk posted the harbor bell notice by the gate."),
	] as const;
	return createFixture(7, "harbor-bell-notice", messages, {
		version: 2,
		fixture_id: "harbor-bell-notice",
		claims: [],
		events: [],
		ambiguities: [],
		noteworthy_candidates: [{ id: "ferry-boarding-notice", kind: "notice", witnesses: [textWitness("announce-01", "ferry boarding begins at noon")] }],
		entities: [],
		numbers: [],
		event_relationships: [],
		irrelevant_message_ids: [],
	}, ["announcement_candidates"], [variationWitness("announcement_candidates", ["noteworthy:ferry-boarding-notice"], ["announce-01"])]);
}

function namesFixture(): ControlledReferenceCorpusFixtureDefinition {
	const messages = [
		message("names-01", 91, "Nell", "Nell signed the Cedar Ledger."),
		message("names-02", 92, "Clerk", "The Cedar Ledger remains on the front desk."),
	] as const;
	return createFixture(8, "cedar-ledger-name", messages, {
		version: 2,
		fixture_id: "cedar-ledger-name",
		claims: [],
		events: [],
		ambiguities: [],
		noteworthy_candidates: [{ id: "ledger-background", kind: "background", witnesses: [textWitness("names-02", "Cedar Ledger remains on the front desk")] }],
		entities: [{ id: "nell", kind: "person", value: "Nell", witnesses: [authorWitness("names-01", "Nell")] }],
		numbers: [],
		event_relationships: [],
		irrelevant_message_ids: [],
	}, ["names"], [variationWitness("names", ["entity:nell"], ["names-01"])]);
}

function numbersFixture(): ControlledReferenceCorpusFixtureDefinition {
	const messages = [
		message("numbers-01", 101, "Milo", "Ledger line shows 17 cedar bundles."),
		message("numbers-02", 102, "Clerk", "The bundle tally is pinned beside the ledger."),
	] as const;
	return createFixture(9, "cedar-bundle-count", messages, {
		version: 2,
		fixture_id: "cedar-bundle-count",
		claims: [],
		events: [],
		ambiguities: [],
		noteworthy_candidates: [{ id: "bundle-tally-background", kind: "background", witnesses: [textWitness("numbers-02", "bundle tally is pinned")] }],
		entities: [],
		numbers: [{ id: "cedar-bundles", raw: "17", witnesses: [textWitness("numbers-01", "17 cedar bundles")] }],
		event_relationships: [],
		irrelevant_message_ids: [],
	}, ["numbers"], [variationWitness("numbers", ["number:cedar-bundles"], ["numbers-01"])]);
}

function irrelevantFixture(): ControlledReferenceCorpusFixtureDefinition {
	const messages = [
		message("irrelevant-01", 111, "Jori", "North Dock opened at sunrise."),
		message("irrelevant-02", 112, "Jori", "I still miss yesterday's plum pie."),
	] as const;
	return createFixture(10, "dock-chatter", messages, {
		version: 2,
		fixture_id: "dock-chatter",
		claims: [{ id: "north-dock-opened", status: "established", supporting_witnesses: [textWitness("irrelevant-01", "North Dock opened at sunrise.")], opposing_witnesses: [], unresolved_witnesses: [] }],
		events: [],
		ambiguities: [],
		noteworthy_candidates: [],
		entities: [],
		numbers: [],
		event_relationships: [],
		irrelevant_message_ids: ["irrelevant-02"],
	}, ["irrelevant_chatter"], [variationWitness("irrelevant_chatter", [], ["irrelevant-02"])]);
}

function fillerFixture(ordinal: number, id: string, subject: string, itemCount: string): ControlledReferenceCorpusFixtureDefinition {
	const firstMessageId = `${id}-01`;
	const secondMessageId = `${id}-02`;
	const variationTag = ordinal % 2 === 0 ? "numbers" : "names";
	const referenceId = variationTag === "numbers" ? `number:${id}-count` : `entity:${id}-subject`;
	const witnessMessageId = variationTag === "numbers" ? secondMessageId : firstMessageId;
	const messages = [
		message(firstMessageId, 120 + (ordinal * 2), subject, `${subject} reached Waypoint ${ordinal}.`),
		message(secondMessageId, 121 + (ordinal * 2), "Clerk", `${subject} logged ${itemCount} crates at Waypoint ${ordinal}.`),
	] as const;
	return createFixture(ordinal, id, messages, {
		version: 2,
		fixture_id: id,
		claims: [{ id: `${id}-arrival`, status: "established", supporting_witnesses: [textWitness(firstMessageId, `${subject} reached Waypoint ${ordinal}.`)], opposing_witnesses: [], unresolved_witnesses: [] }],
		events: [],
		ambiguities: [],
		noteworthy_candidates: [],
		entities: variationTag === "names" ? [{ id: `${id}-subject`, kind: "person", value: subject, witnesses: [authorWitness(firstMessageId, subject)] }] : [],
		numbers: variationTag === "numbers" ? [{ id: `${id}-count`, raw: itemCount, witnesses: [textWitness(secondMessageId, `${itemCount} crates`)] }] : [],
		event_relationships: [],
		irrelevant_message_ids: [],
	}, [variationTag], [variationWitness(variationTag, [referenceId], [witnessMessageId])]);
}

export function buildControlledReferenceCorpusFixtures(): readonly ControlledReferenceCorpusFixtureDefinition[] {
	return [
		denseFixture(),
		sparseFixture(),
		overlappingFixture(),
		isolatedFixture(),
		contradictionFixture(),
		unresolvedFixture(),
		announcementFixture(),
		namesFixture(),
		numbersFixture(),
		irrelevantFixture(),
		fillerFixture(11, "filler-11", "Scout Eleven", "13"),
		fillerFixture(12, "filler-12", "Scout Twelve", "14"),
	];
}
