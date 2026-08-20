import { EvaluationReferenceSchema } from "./evaluation-reference-corpus";
import {
	type LegacyPreparedMessage,
	type LegacyReferenceProjection,
	legacyAuthorWitness,
	legacyTextWitness,
} from "./evaluation-scorecard-verifier-controlled-legacy-v2-support";

export function legacyReferenceProjectionPartTwo(
	fixtureId: string,
	messages: readonly LegacyPreparedMessage[],
): LegacyReferenceProjection | undefined {
	switch (fixtureId) {
		case "isolated-bell-test":
			return {
				reference: EvaluationReferenceSchema.parse({
					version: 2,
					fixture_id: fixtureId,
					claims: [],
					events: [
						{
							id: "harbor-bell-test",
							status: "established",
							supporting_witnesses: [legacyTextWitness(messages, "bell-01", "harbor bell test finished")],
							opposing_witnesses: [],
							unresolved_witnesses: [],
						},
						{
							id: "orchard-pruning-start",
							status: "established",
							supporting_witnesses: [legacyTextWitness(messages, "bell-03", "orchard crew started pruning")],
							opposing_witnesses: [],
							unresolved_witnesses: [],
						},
					],
					ambiguities: [],
					noteworthy_candidates: [],
					entities: [],
					numbers: [{
						id: "bell-strike-count",
						raw: "3",
						witnesses: [legacyTextWitness(messages, "bell-02", "3 bell strikes")],
					}],
					event_relationships: [{
						id: "harbor-bell-test-isolated",
						kind: "isolated",
						event_ids: ["harbor-bell-test"],
					}],
					irrelevant_message_ids: [],
				}),
				variation_tags: ["isolated_event"],
				variation_witnesses: [{
					tag: "isolated_event",
					reference_ids: ["relationship:harbor-bell-test-isolated", "event:harbor-bell-test"],
					message_ids: ["bell-01"],
				}],
			};
		case "lantern-festival-notice":
			return {
				reference: EvaluationReferenceSchema.parse({
					version: 2,
					fixture_id: fixtureId,
					claims: [],
					events: [{
						id: "lantern-festival-start",
						status: "established",
						supporting_witnesses: [legacyTextWitness(messages, "festival-01", "Lantern Festival begins at 19:00 UTC")],
						opposing_witnesses: [],
						unresolved_witnesses: [],
					}],
					ambiguities: [],
					noteworthy_candidates: [
						{
							id: "festival-start-notice",
							kind: "notice",
							witnesses: [legacyTextWitness(messages, "festival-01", "Lantern Festival begins at 19:00 UTC")],
						},
						{
							id: "jar-return-request",
							kind: "request",
							witnesses: [legacyTextWitness(messages, "festival-05", "empty jars to the return table")],
						},
					],
					entities: [],
					numbers: [{
						id: "lantern-count",
						raw: "40",
						witnesses: [legacyTextWitness(messages, "festival-02", "40 lanterns")],
					}],
					event_relationships: [],
					irrelevant_message_ids: [],
				}),
				variation_tags: ["announcement_candidates"],
				variation_witnesses: [{
					tag: "announcement_candidates",
					reference_ids: ["noteworthy:festival-start-notice"],
					message_ids: ["festival-01"],
				}],
			};
		case "supply-counts":
			return {
				reference: EvaluationReferenceSchema.parse({
					version: 2,
					fixture_id: fixtureId,
					claims: [{
						id: "flour-sack-count",
						status: "established",
						supporting_witnesses: [
							legacyTextWitness(messages, "supply-01", "32 flour sacks"),
							legacyTextWitness(messages, "supply-03", "32 flour sacks"),
						],
						opposing_witnesses: [],
						unresolved_witnesses: [],
					}],
					events: [],
					ambiguities: [],
					noteworthy_candidates: [{
						id: "inventory-background",
						kind: "background",
						witnesses: [legacyTextWitness(messages, "supply-03", "inventory sheet lists 32 flour sacks")],
					}],
					entities: [],
					numbers: [
						{
							id: "flour-count",
							raw: "32",
							witnesses: [legacyTextWitness(messages, "supply-01", "32 flour sacks")],
						},
						{
							id: "salt-count",
							raw: "11",
							witnesses: [legacyTextWitness(messages, "supply-02", "11 salt crates")],
						},
					],
					event_relationships: [],
					irrelevant_message_ids: [],
				}),
				variation_tags: ["numbers"],
				variation_witnesses: [{
					tag: "numbers",
					reference_ids: ["number:flour-count", "number:salt-count"],
					message_ids: ["supply-01", "supply-02"],
				}],
			};
		case "named-rangers":
			return {
				reference: EvaluationReferenceSchema.parse({
					version: 2,
					fixture_id: fixtureId,
					claims: [{
						id: "rangers-at-birch-watch",
						status: "established",
						supporting_witnesses: [legacyTextWitness(messages, "rangers-01", "Suri and Tomas reached Birch Watch")],
						opposing_witnesses: [],
						unresolved_witnesses: [],
					}],
					events: [],
					ambiguities: [],
					noteworthy_candidates: [],
					entities: [
						{
							id: "suri",
							kind: "person",
							value: "Suri",
							witnesses: [legacyAuthorWitness(messages, "rangers-02", "Suri")],
						},
						{
							id: "tomas",
							kind: "person",
							value: "Tomas",
							witnesses: [legacyAuthorWitness(messages, "rangers-03", "Tomas")],
						},
					],
					numbers: [],
					event_relationships: [],
					irrelevant_message_ids: [],
				}),
				variation_tags: ["names"],
				variation_witnesses: [{
					tag: "names",
					reference_ids: ["entity:suri", "entity:tomas"],
					message_ids: ["rangers-02", "rangers-03"],
				}],
			};
		case "contested-closure":
			return {
				reference: EvaluationReferenceSchema.parse({
					version: 2,
					fixture_id: fixtureId,
					claims: [],
					events: [{
						id: "north-quarry-closure",
						status: "contested",
						supporting_witnesses: [legacyTextWitness(messages, "closure-01", "north quarry closed at 20:00 UTC")],
						opposing_witnesses: [
							legacyTextWitness(messages, "closure-02", "still admitting carts"),
							legacyTextWitness(messages, "closure-04", "entered after 20:00 UTC"),
						],
						unresolved_witnesses: [],
					}],
					ambiguities: [],
					noteworthy_candidates: [{
						id: "closure-notice",
						kind: "notice",
						witnesses: [legacyTextWitness(messages, "closure-03", "closure notice is posted")],
					}],
					entities: [],
					numbers: [],
					event_relationships: [],
					irrelevant_message_ids: [],
				}),
				variation_tags: ["contradiction"],
				variation_witnesses: [{
					tag: "contradiction",
					reference_ids: ["event:north-quarry-closure"],
					message_ids: ["closure-01", "closure-02", "closure-04"],
				}],
			};
		case "unresolved-departure":
			return {
				reference: EvaluationReferenceSchema.parse({
					version: 2,
					fixture_id: fixtureId,
					claims: [],
					events: [{
						id: "survey-departure",
						status: "unresolved",
						supporting_witnesses: [],
						opposing_witnesses: [],
						unresolved_witnesses: [legacyTextWitness(messages, "departure-01", "leave after the second bell")],
					}],
					ambiguities: [{
						id: "second-bell-time",
						witnesses: [legacyTextWitness(messages, "departure-02", "noon bell or evening bell")],
					}],
					noteworthy_candidates: [{
						id: "departure-time-notice",
						kind: "notice",
						witnesses: [legacyTextWitness(messages, "departure-03", "confirmed departure time")],
					}],
					entities: [],
					numbers: [],
					event_relationships: [],
					irrelevant_message_ids: [],
				}),
				variation_tags: ["unresolved_ambiguity"],
				variation_witnesses: [{
					tag: "unresolved_ambiguity",
					reference_ids: ["event:survey-departure", "ambiguity:second-bell-time"],
					message_ids: ["departure-01", "departure-02"],
				}],
			};
		default:
			return undefined;
	}
}
