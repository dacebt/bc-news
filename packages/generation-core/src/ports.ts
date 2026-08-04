import type { EvidenceMessage } from "@bc-news/contracts";

export type EditorialCapability = "main_story" | "announcements";

export interface EvidenceInputPort {
	loadEvidence(request: {
		activeRegionId: string;
		evidenceDate: string;
	}): Promise<EvidenceMessage[]>;
}

export interface ModelProviderPort {
	complete(request: {
		editorialCapability: EditorialCapability;
		system: string;
		user: string;
	}): Promise<{ text: string; provider: string; model: string }>;
}
