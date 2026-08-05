import type { GenerationRunParams } from "@bc-news/contracts";

export const GENERATION_STEPS = [
	"prepare-evidence",
	"compose-main-story",
	"compose-announcements",
	"compose-packaging",
	"validate-edition",
	"publish-edition",
] as const;

export interface WalkModelUsageRecord {
	editorial_capability: string;
	provider: string;
	model: string;
	execution: string;
	token_usage: { measurement: string };
	external_billing: { classification: string; amount_usd?: number; reason?: string };
}

export interface WalkGenerationRunStatus {
	active_region_id: string;
	publication_date: string;
	generation_run_id: string;
	state: string;
	current_step: string | null;
	completed_steps: string[];
	model_usage: WalkModelUsageRecord[];
	failure: { step: string; code: string; message: string } | null;
	workflow:
		| { observation: "available"; status: string; error: { name: string; message: string } | null }
		| { observation: "unavailable"; error: { name: string; message: string } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function generationRunStatusUrl(baseUrl: string, pair: GenerationRunParams): string {
	const query = new URLSearchParams(pair);
	return `${baseUrl}/generation-run?${query.toString()}`;
}

export function parseGenerationRunStatusResponse(
	body: string,
	expectedPair: GenerationRunParams,
): WalkGenerationRunStatus {
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch (error) {
		throw new Error("generation run operator status is not valid JSON", { cause: error });
	}
	if (
		!isRecord(parsed) ||
		parsed["active_region_id"] !== expectedPair.active_region_id ||
		parsed["publication_date"] !== expectedPair.publication_date ||
		parsed["generation_run_id"] !== `generation-run-${expectedPair.active_region_id}-${expectedPair.publication_date}` ||
		typeof parsed["state"] !== "string" ||
		!(parsed["current_step"] === null || typeof parsed["current_step"] === "string") ||
		!Array.isArray(parsed["completed_steps"]) ||
		!Array.isArray(parsed["model_usage"]) ||
		!isRecord(parsed["workflow"])
	) {
		throw new Error(`generation run operator status has an invalid envelope: ${body}`);
	}
	for (const record of parsed["model_usage"]) {
		if (
			!isRecord(record) ||
			typeof record["editorial_capability"] !== "string" ||
			typeof record["provider"] !== "string" ||
			typeof record["model"] !== "string" ||
			typeof record["execution"] !== "string" ||
			!isRecord(record["token_usage"]) ||
			!isRecord(record["external_billing"])
		) {
			throw new Error(`generation run operator status has invalid model usage: ${body}`);
		}
	}
	const failure = parsed["failure"];
	if (
		failure !== null &&
		(!isRecord(failure) ||
			typeof failure["step"] !== "string" ||
			typeof failure["code"] !== "string" ||
			typeof failure["message"] !== "string")
	) {
		throw new Error(`generation run operator status has invalid failure: ${body}`);
	}
	return parsed as unknown as WalkGenerationRunStatus;
}

export async function fetchGenerationRunStatus(
	baseUrl: string,
	pair: GenerationRunParams,
): Promise<WalkGenerationRunStatus> {
	const response = await fetch(generationRunStatusUrl(baseUrl, pair));
	const body = await response.text();
	if (response.status !== 200) {
		throw new Error(
			`generation run ${pair.active_region_id}/${pair.publication_date} expected status 200, got ${response.status} ${body}`,
		);
	}
	return parseGenerationRunStatusResponse(body, pair);
}
