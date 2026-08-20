import { assertProof } from "./evaluation-scorecard-verifier-support";
import { legacyReferenceProjectionPartOne } from "./evaluation-scorecard-verifier-controlled-legacy-v2-reference-part-one";
import { legacyReferenceProjectionPartTwo } from "./evaluation-scorecard-verifier-controlled-legacy-v2-reference-part-two";
import {
	type LegacyPreparedMessage,
	type LegacyReferenceProjection,
} from "./evaluation-scorecard-verifier-controlled-legacy-v2-support";

export function legacyReferenceProjection(
	fixtureId: string,
	messages: readonly LegacyPreparedMessage[],
): LegacyReferenceProjection {
	const projection =
		legacyReferenceProjectionPartOne(fixtureId, messages)
		?? legacyReferenceProjectionPartTwo(fixtureId, messages);
	assertProof(projection !== undefined, `Controlled legacy V2 fixture is unmapped: ${fixtureId}`);
	return projection;
}
