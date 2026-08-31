import type { GenerationRunParams } from "@bc-news/contracts";
import {
	CURRENT_V2_GENERATION_RUN_CONTRACT_VERSION,
	type GenerationRunStatusHttpResponse,
	type WalkGenerationRunStatus,
} from "./generation-run-status-types";
import {
	parseCurrentV2GenerationRunStatusResponse,
} from "./generation-run-status-attempts";
import {
	parseCurrentV1GenerationRunStatusResponse,
	parseLegacyGenerationRunStatusResponse,
} from "./generation-run-status-projection";
import { hasOwn, isRecord } from "./generation-run-status-guards";

export { GENERATION_STEPS } from "./generation-run-status-types";
export type {
	CurrentV1WalkGenerationRunStatus,
	CurrentV2WalkGenerationRunStatus,
	GenerationRunStatusHttpResponse,
	LegacyWalkGenerationRunStatus,
	WalkEditorialDiagnostic,
	WalkGenerationRunStatus,
	WalkModelAttemptRecord,
	WalkModelUsageRecord,
} from "./generation-run-status-types";

export function generationRunStatusUrl(baseUrl: string, pair: GenerationRunParams): string {
	const query = new URLSearchParams(pair);
	return `${baseUrl}/generation-run?${query.toString()}`;
}

export async function requestGenerationRunStatus(
	baseUrl: string,
	pair: GenerationRunParams,
	operatorToken: string,
): Promise<GenerationRunStatusHttpResponse> {
	const response = await fetch(generationRunStatusUrl(baseUrl, pair), {
		headers: { Authorization: `Bearer ${operatorToken}` },
	});
	return {
		status: response.status,
		body: await response.text(),
		cacheControl: response.headers.get("cache-control"),
	};
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
	if (!isRecord(parsed)) {
		throw new Error(`generation run operator status has an invalid envelope: ${body}`);
	}
	if (parsed["contract_version"] === CURRENT_V2_GENERATION_RUN_CONTRACT_VERSION) {
		return parseCurrentV2GenerationRunStatusResponse(parsed, body, expectedPair);
	}
	if (hasOwn(parsed, "contract_version")) {
		return parseCurrentV1GenerationRunStatusResponse(parsed, body, expectedPair);
	}
	return parseLegacyGenerationRunStatusResponse(parsed, body, expectedPair);
}

export async function fetchGenerationRunStatus(
	baseUrl: string,
	pair: GenerationRunParams,
	operatorToken: string,
): Promise<WalkGenerationRunStatus> {
	const response = await requestGenerationRunStatus(baseUrl, pair, operatorToken);
	if (response.status !== 200) {
		throw new Error(
			`generation run ${pair.active_region_id}/${pair.publication_date} expected status 200, got ${response.status} ${response.body}`,
		);
	}
	const cacheDirectives = response.cacheControl
		?.split(",")
		.map((directive) => directive.trim().toLowerCase());
	if (!cacheDirectives?.includes("no-store")) {
		throw new Error(
			`generation run ${pair.active_region_id}/${pair.publication_date} expected Cache-Control: no-store, got ${JSON.stringify(response.cacheControl)}`,
		);
	}
	return parseGenerationRunStatusResponse(response.body, pair);
}
