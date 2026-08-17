import type { EvidenceFixture } from "@bc-news/contracts";
import type { PreparedEvidence } from "@bc-news/generation-core";
import type { EvaluationCorpusVariationTag, EvaluationReference } from "./evaluation-reference-corpus";

type VariationWitness = {
	readonly tag: EvaluationCorpusVariationTag;
	readonly reference_ids: readonly string[];
	readonly message_ids: readonly string[];
};

interface LoadedCorpusEntryForRules {
	readonly manifestEntry: {
		readonly id: string;
		readonly variation_tags: readonly EvaluationCorpusVariationTag[];
		readonly variation_witnesses: readonly VariationWitness[];
	};
	readonly fixture: EvidenceFixture;
	readonly preparedEvidence: PreparedEvidence;
	readonly referencePath: string;
	readonly reference: EvaluationReference;
}

interface CorpusRulesTools {
	readonly fail: (code: string, path: string, message: string) => never;
	readonly statusWitnesses: (record: EvaluationReference["claims"][number]) => Array<{ message_id: string }>;
	readonly unique: (values: readonly string[], path: string, subject: string) => void;
}

function earliestEventTimestamp(reference: EvaluationReference, fixture: EvidenceFixture, eventId: string, path: string, tools: CorpusRulesTools): number {
	const event = reference.events.find(({ id }) => id === eventId);
	if (event === undefined) tools.fail("invalid_relationship", path, `Relationship names missing event ${eventId}`);
	const timestamps = tools.statusWitnesses(event).map((witness) => fixture.messages.find(({ id }) => id === witness.message_id)?.ts);
	if (timestamps.some((value) => value === undefined)) tools.fail("invalid_relationship", path, `Event ${eventId} has a dangling witness`);
	return Math.min(...timestamps as number[]);
}

function validateRelationships(entry: LoadedCorpusEntryForRules, tools: CorpusRulesTools): void {
	for (const relationship of entry.reference.event_relationships) {
		tools.unique(relationship.event_ids, entry.referencePath, `${relationship.id} event ids`);
		const timestamps = relationship.event_ids.map((id) => earliestEventTimestamp(entry.reference, entry.fixture, id, entry.referencePath, tools));
		if (relationship.kind === "overlaps") {
			if (timestamps.length < 2 || Math.max(...timestamps) - Math.min(...timestamps) > 15 * 60_000) {
				tools.fail("invalid_relationship", entry.referencePath, `${relationship.id} is not overlapping`);
			}
			continue;
		}
		if (timestamps.length !== 1) tools.fail("invalid_relationship", entry.referencePath, `${relationship.id} must name one event`);
		const otherTimes = entry.reference.events.filter(({ id }) => id !== relationship.event_ids[0]).map(({ id }) => earliestEventTimestamp(entry.reference, entry.fixture, id, entry.referencePath, tools));
		if (otherTimes.some((time) => Math.abs(time - timestamps[0]!) <= 60 * 60_000)) {
			tools.fail("invalid_relationship", entry.referencePath, `${relationship.id} is not isolated`);
		}
	}
}

function qualifiedReference(entry: LoadedCorpusEntryForRules, value: string): unknown {
	const [kind, id, ...rest] = value.split(":");
	if (kind === undefined || id === undefined || rest.length > 0) return undefined;
	const collections = {
		claim: entry.reference.claims,
		event: entry.reference.events,
		ambiguity: entry.reference.ambiguities,
		noteworthy: entry.reference.noteworthy_candidates,
		entity: entry.reference.entities,
		number: entry.reference.numbers,
		relationship: entry.reference.event_relationships,
	} as const;
	return kind in collections ? collections[kind as keyof typeof collections].find((record) => record.id === id) : undefined;
}

function witnessMessageIds(value: unknown): string[] {
	if (typeof value !== "object" || value === null) return [];
	const record = value as Record<string, unknown>;
	const groups = [record.witnesses, record.supporting_witnesses, record.opposing_witnesses, record.unresolved_witnesses];
	return groups.flatMap((group) => Array.isArray(group) ? group.map((item) => (item as { message_id?: string }).message_id).filter((id): id is string => id !== undefined) : []);
}

function validateVariation(entry: LoadedCorpusEntryForRules, sparseMaximum: number, tools: CorpusRulesTools): void {
	const declared = entry.manifestEntry.variation_tags;
	tools.unique(declared, entry.manifestEntry.id, "variation tags");
	if (entry.manifestEntry.variation_witnesses.map(({ tag }) => tag).join("|") !== declared.join("|")) {
		tools.fail("false_variation", entry.manifestEntry.id, "Variation witnesses must match declared tag order");
	}
	const preparedIds = new Set(entry.preparedEvidence.messages.map(({ id }) => id));
	for (const witness of entry.manifestEntry.variation_witnesses) {
		tools.unique(witness.reference_ids, entry.manifestEntry.id, `${witness.tag} reference ids`);
		tools.unique(witness.message_ids, entry.manifestEntry.id, `${witness.tag} message ids`);
		const references = witness.reference_ids.map((id) => qualifiedReference(entry, id));
		if (references.some((record) => record === undefined) || witness.message_ids.some((id) => !preparedIds.has(id))) {
			tools.fail("false_variation", entry.manifestEntry.id, `${witness.tag} has dangling witnesses`);
		}
		const citedIds = new Set(references.flatMap(witnessMessageIds));
		const coversCited = [...citedIds].every((id) => witness.message_ids.includes(id));
		const referenceById = new Map(witness.reference_ids.map((id, index) => [id, references[index]]));
		const relationshipProof = (kind: "overlaps" | "isolated"): boolean => {
			const relationshipPair = [...referenceById].find(([id, record]) => id.startsWith("relationship:") && (record as { kind?: string } | undefined)?.kind === kind);
			if (relationshipPair === undefined) return false;
			const relationship = relationshipPair[1] as EvaluationReference["event_relationships"][number];
			return relationship.event_ids.every((id) => referenceById.has(`event:${id}`)) && relationship.event_ids.flatMap((id) => {
				const event = referenceById.get(`event:${id}`) as EvaluationReference["events"][number];
				return tools.statusWitnesses(event).map(({ message_id }) => message_id);
			}).every((id) => witness.message_ids.includes(id));
		};
		const valid = witness.tag === "dense" ? entry.preparedEvidence.final_count >= 24 && witness.message_ids.length >= 24
			: witness.tag === "sparse" ? entry.preparedEvidence.final_count <= sparseMaximum && witness.message_ids.length === preparedIds.size && witness.message_ids.every((id) => preparedIds.has(id))
			: witness.tag === "overlapping_events" ? relationshipProof("overlaps") && coversCited
			: witness.tag === "isolated_event" ? relationshipProof("isolated") && coversCited
			: witness.tag === "contradiction" ? references.some((record) => (record as { status?: string }).status === "contested") && coversCited
			: witness.tag === "unresolved_ambiguity" ? [...referenceById].some(([id, record]) => id.startsWith("ambiguity:") || ((id.startsWith("claim:") || id.startsWith("event:")) && (record as { status?: string }).status === "unresolved")) && coversCited
			: witness.tag === "names" ? witness.reference_ids.some((id) => id.startsWith("entity:")) && coversCited
			: witness.tag === "numbers" ? witness.reference_ids.some((id) => id.startsWith("number:")) && coversCited
			: witness.tag === "announcement_candidates" ? [...referenceById].some(([id, record]) => id.startsWith("noteworthy:") && (record as { kind?: string }).kind !== "background") && coversCited
			: witness.message_ids.length > 0 && witness.message_ids.every((id) => entry.reference.irrelevant_message_ids.includes(id));
		if (!valid) tools.fail("false_variation", entry.manifestEntry.id, `${witness.tag} is not objectively witnessed`);
	}
}

export function validateReferenceRules(entry: LoadedCorpusEntryForRules, sparseMaximum: number, tools: CorpusRulesTools): void {
	validateRelationships(entry, tools);
	validateVariation(entry, sparseMaximum, tools);
}
