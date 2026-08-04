import { EvidenceFixtureSchema, type EvidenceMessage } from "@bc-news/contracts";
import type { EvidenceInputPort } from "@bc-news/generation-core";
import evidenceFixtureJson from "../evidence/active-region-7_2026-01-24.json";

interface EvidencePair {
	activeRegionId: string;
	evidenceDate: string;
}

/**
 * Thrown instead of returning empty evidence when the requested pair is not
 * the committed fixture's: a silent empty result would surface downstream as a
 * confusing no_evidence failure, and serving the fixture anyway would hand a
 * generation run wrong-region or wrong-day evidence.
 */
export class FixtureEvidenceMismatchError extends Error {
	readonly code = "fixture_evidence_pair_mismatch";
	readonly requested: EvidencePair;
	readonly available: EvidencePair;

	constructor(requested: EvidencePair, available: EvidencePair) {
		super(
			`Fixture evidence covers active region ${available.activeRegionId} on evidence date ${available.evidenceDate}; ` +
				`refusing request for active region ${requested.activeRegionId} on evidence date ${requested.evidenceDate}`,
		);
		this.name = "FixtureEvidenceMismatchError";
		this.requested = requested;
		this.available = available;
	}
}

export const fixtureEvidenceInput: EvidenceInputPort = {
	loadEvidence(request): Promise<EvidenceMessage[]> {
		const fixture = EvidenceFixtureSchema.parse(evidenceFixtureJson);
		const available: EvidencePair = {
			activeRegionId: fixture.active_region_id,
			evidenceDate: fixture.evidence_date,
		};
		if (
			available.activeRegionId !== request.activeRegionId ||
			available.evidenceDate !== request.evidenceDate
		) {
			throw new FixtureEvidenceMismatchError(request, available);
		}
		return Promise.resolve(fixture.messages);
	},
};
