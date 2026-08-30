import { resolveFixtureGameReferenceIdentities } from "@bc-news/fixtures";
import {
	buildGameReferenceEntityIdentities,
	prepareEvidence,
	prepareEvidenceWithGameReferenceResolutions as finalizePreparedFixtureEvidence,
} from "@bc-news/generation-core";

type FixturePreparedEvidenceInput = Parameters<typeof finalizePreparedFixtureEvidence>[0];

export function prepareFixtureEvidenceWithGameReferenceResolutions(
	input: FixturePreparedEvidenceInput,
) {
	const prepared = prepareEvidence(input);
	return finalizePreparedFixtureEvidence(
		input,
		resolveFixtureGameReferenceIdentities(
			buildGameReferenceEntityIdentities(prepared.messages),
		),
	);
}

export async function prepareFixtureEvidenceWithGameReferences(
	input: FixturePreparedEvidenceInput,
) {
	return Promise.resolve(prepareFixtureEvidenceWithGameReferenceResolutions(input));
}
