import { EvaluationReferenceSchema } from "./evaluation-reference-corpus";
import {
	type LegacyPreparedMessage,
	type LegacyReferenceProjection,
	legacyTextWitness,
} from "./evaluation-scorecard-verifier-controlled-legacy-v2-support";

export function legacyReferenceProjectionPartOne(
	fixtureId: string,
	messages: readonly LegacyPreparedMessage[],
): LegacyReferenceProjection | undefined {
	switch (fixtureId) {
		case "dense-market-day":
			return {
				reference: EvaluationReferenceSchema.parse({
					version: 2,
					fixture_id: fixtureId,
					claims: [],
					events: [],
					ambiguities: [],
					noteworthy_candidates: [{
						id: "rope-request",
						kind: "request",
						witnesses: [legacyTextWitness(messages, "dense-18", "requested rope")],
					}],
					entities: [],
					numbers: [],
					event_relationships: [],
					irrelevant_message_ids: [],
				}),
				variation_tags: ["dense"],
				variation_witnesses: [{
					tag: "dense",
					reference_ids: [],
					message_ids: messages.map(({ id }) => id),
				}],
			};
		case "sparse-repair-update":
			return {
				reference: EvaluationReferenceSchema.parse({
					version: 2,
					fixture_id: fixtureId,
					claims: [],
					events: [{
						id: "moss-bridge-repair",
						status: "established",
						supporting_witnesses: [
							legacyTextWitness(messages, "repair-01", "Repairs at Moss Bridge finished"),
							legacyTextWitness(messages, "repair-03", "Moss Bridge is open again."),
						],
						opposing_witnesses: [],
						unresolved_witnesses: [],
					}],
					ambiguities: [],
					noteworthy_candidates: [{
						id: "bridge-open-notice",
						kind: "notice",
						witnesses: [legacyTextWitness(messages, "repair-03", "Moss Bridge is open again.")],
					}],
					entities: [],
					numbers: [{
						id: "oak-plank-count",
						raw: "6",
						witnesses: [legacyTextWitness(messages, "repair-02", "6 oak planks")],
					}],
					event_relationships: [],
					irrelevant_message_ids: [],
				}),
				variation_tags: ["sparse"],
				variation_witnesses: [{
					tag: "sparse",
					reference_ids: [],
					message_ids: messages.map(({ id }) => id),
				}],
			};
		case "overlapping-deliveries":
			return {
				reference: EvaluationReferenceSchema.parse({
					version: 2,
					fixture_id: fixtureId,
					claims: [],
					events: [
						{
							id: "grain-cart-arrival",
							status: "established",
							supporting_witnesses: [legacyTextWitness(messages, "overlap-01", "grain cart arrived at River Depot")],
							opposing_witnesses: [],
							unresolved_witnesses: [],
						},
						{
							id: "timber-wagon-arrival",
							status: "established",
							supporting_witnesses: [legacyTextWitness(messages, "overlap-03", "timber wagon reached River Depot")],
							opposing_witnesses: [],
							unresolved_witnesses: [],
						},
					],
					ambiguities: [],
					noteworthy_candidates: [],
					entities: [],
					numbers: [{
						id: "pine-beam-count",
						raw: "14",
						witnesses: [legacyTextWitness(messages, "overlap-04", "14 pine beams")],
					}],
					event_relationships: [{
						id: "deliveries-overlap",
						kind: "overlaps",
						event_ids: ["grain-cart-arrival", "timber-wagon-arrival"],
					}],
					irrelevant_message_ids: [],
				}),
				variation_tags: ["overlapping_events"],
				variation_witnesses: [{
					tag: "overlapping_events",
					reference_ids: [
						"relationship:deliveries-overlap",
						"event:grain-cart-arrival",
						"event:timber-wagon-arrival",
					],
					message_ids: ["overlap-01", "overlap-03"],
				}],
			};
		case "conflicting-toll-count":
			return {
				reference: EvaluationReferenceSchema.parse({
					version: 2,
					fixture_id: fixtureId,
					claims: [{
						id: "stone-gate-toll",
						status: "contested",
						supporting_witnesses: [
							legacyTextWitness(messages, "toll-01", "8 copper today"),
							legacyTextWitness(messages, "toll-03", "paid 8 copper"),
						],
						opposing_witnesses: [legacyTextWitness(messages, "toll-02", "10 copper")],
						unresolved_witnesses: [],
					}],
					events: [],
					ambiguities: [],
					noteworthy_candidates: [],
					entities: [],
					numbers: [
						{
							id: "reported-toll-eight",
							raw: "8",
							witnesses: [legacyTextWitness(messages, "toll-01", "8 copper")],
						},
						{
							id: "posted-toll-ten",
							raw: "10",
							witnesses: [legacyTextWitness(messages, "toll-02", "10 copper")],
						},
					],
					event_relationships: [],
					irrelevant_message_ids: [],
				}),
				variation_tags: ["contradiction"],
				variation_witnesses: [{
					tag: "contradiction",
					reference_ids: ["claim:stone-gate-toll"],
					message_ids: ["toll-01", "toll-02", "toll-03"],
				}],
			};
		case "unresolved-location":
			return {
				reference: EvaluationReferenceSchema.parse({
					version: 2,
					fixture_id: fixtureId,
					claims: [],
					events: [],
					ambiguities: [{
						id: "old-tower-identity",
						witnesses: [
							legacyTextWitness(messages, "location-01", "old tower"),
							legacyTextWitness(messages, "location-02", "east tower or the flooded tower"),
							legacyTextWitness(messages, "location-03", "which old tower"),
						],
					}],
					noteworthy_candidates: [],
					entities: [],
					numbers: [],
					event_relationships: [],
					irrelevant_message_ids: [],
				}),
				variation_tags: ["unresolved_ambiguity"],
				variation_witnesses: [{
					tag: "unresolved_ambiguity",
					reference_ids: ["ambiguity:old-tower-identity"],
					message_ids: ["location-01", "location-02", "location-03"],
				}],
			};
		case "irrelevant-campfire":
			return {
				reference: EvaluationReferenceSchema.parse({
					version: 2,
					fixture_id: fixtureId,
					claims: [{
						id: "spare-bedroll-count",
						status: "established",
						supporting_witnesses: [legacyTextWitness(messages, "campfire-01", "5 spare bedrolls")],
						opposing_witnesses: [],
						unresolved_witnesses: [],
					}],
					events: [],
					ambiguities: [],
					noteworthy_candidates: [],
					entities: [],
					numbers: [{
						id: "bedroll-count",
						raw: "5",
						witnesses: [legacyTextWitness(messages, "campfire-01", "5 spare bedrolls")],
					}],
					event_relationships: [],
					irrelevant_message_ids: ["campfire-03", "campfire-04", "campfire-05"],
				}),
				variation_tags: ["irrelevant_chatter"],
				variation_witnesses: [{
					tag: "irrelevant_chatter",
					reference_ids: [],
					message_ids: ["campfire-03", "campfire-04", "campfire-05"],
				}],
			};
		default:
			return undefined;
	}
}
