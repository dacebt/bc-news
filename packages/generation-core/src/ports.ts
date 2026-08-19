import type { EvidenceMessage } from "@bc-news/contracts";
import type { ModelRuntimeEvidence } from "./runtime-evidence";

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
	text: string | null;
	provider: string;
	model: string;
	execution: "recorded_replay" | "local_inference" | "hosted_inference";
	token_usage: TokenUsage;
	external_billing: ExternalBilling;
	request_provenance?: ModelRequestProvenance | undefined;
	runtime_evidence?: ModelRuntimeEvidence;
}

export interface ModelRequestCorrelation {
	readonly run_id: string;
	readonly invocation_id: string;
}

export interface CloudflareAiGatewayRequestProvenance {
	transport: "cloudflare_ai_gateway_rest";
	account_id: string;
	gateway: { selection: "named"; id: string } | { selection: "account_default" };
	gateway_log_id: string | { state: "unavailable"; reason: "provider_did_not_report" };
	requested_model: string;
	correlation: ModelRequestCorrelation;
	policy: {
		cache: "bypass";
		log_metadata: true;
		log_payload: false;
		max_attempts: 1;
		request_timeout_ms: number;
		request_format: "chat_completions" | "responses";
		response_delivery: "buffered" | "streaming";
		structured_output: {
			format: "openai_chat_json_schema" | "openai_responses_json_schema";
			contract_name: string;
		};
	};
}

export type ModelRequestProvenance = CloudflareAiGatewayRequestProvenance;

export interface ModelProviderRequest {
	readonly productionStep: ProductionModelStep;
	readonly system: string;
	readonly user: string;
	readonly correlation?: ModelRequestCorrelation;
}

export interface ModelUsageRecord {
	production_step: ProductionModelStep;
	provider: string;
	model: string;
	execution: ModelCompletion["execution"];
	token_usage: TokenUsage;
	external_billing: ExternalBilling;
	request_provenance?: ModelRequestProvenance | undefined;
}

export interface EvidenceInputPort {
	loadEvidence(request: {
		activeRegionId: string;
		evidenceDate: string;
	}): Promise<EvidenceMessage[]>;
}

export interface ModelProviderPort {
	complete(request: ModelProviderRequest): Promise<ModelCompletion>;
}
