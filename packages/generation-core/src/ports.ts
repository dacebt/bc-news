import type { EvidenceMessage } from "@bc-news/contracts";

export type EditorialProduct = "main_story" | "announcements";

export type ProductionModelStep =
	| "main_story_write"
	| "main_story_copyedit"
	| "announcements_write"
	| "announcements_copyedit";

export type TokenUsage =
	| {
			measurement: "reported";
			input_tokens: number;
			output_tokens: number;
			total_tokens: number;
	  }
	| { measurement: "unavailable" };

export type ExternalBilling =
	| {
			classification: "none";
			amount_usd: 0;
			reason: "recorded_replay" | "local_inference";
	  }
	| { classification: "provider_reported"; amount_usd: number }
	| { classification: "calculated"; amount_usd: number; pricing_reference: string }
	| { classification: "unavailable"; reason: "provider_did_not_report_cost" };

export interface ModelCompletion {
	text: string;
	provider: string;
	model: string;
	execution: "recorded_replay" | "local_inference" | "hosted_inference";
	token_usage: TokenUsage;
	external_billing: ExternalBilling;
}

export type ModelUsageRecord = Omit<ModelCompletion, "text"> & {
	production_step: ProductionModelStep;
};

export interface EvidenceInputPort {
	loadEvidence(request: {
		activeRegionId: string;
		evidenceDate: string;
	}): Promise<EvidenceMessage[]>;
}

export interface ModelProviderPort {
	complete(request: {
		productionStep: ProductionModelStep;
		system: string;
		user: string;
	}): Promise<ModelCompletion>;
}
