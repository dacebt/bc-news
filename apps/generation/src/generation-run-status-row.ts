import type { GenerationRunParams } from "@bc-news/contracts";
import type {
	CurrentGenerationRunProjection,
	CurrentV1GenerationRunProjection,
	CurrentV2GenerationRunProjection,
	GenerationRunProjection,
	LegacyGenerationRunProjection,
} from "./generation-run-status-projection";
import {
	CURRENT_GENERATION_RUN_CONTRACT_VERSION,
	CurrentV1GenerationRunProjectionSchema,
	CurrentV2GenerationRunProjectionSchema,
	LegacyGenerationRunProjectionSchema,
	PREVIOUS_CURRENT_GENERATION_RUN_CONTRACT_VERSION,
} from "./generation-run-status-projection";

export interface GenerationRunStatusRow {
	contract_version: string | null;
	active_region_id: string;
	publication_date: string;
	state: string;
	current_step: string | null;
	completed_steps_json: string;
	model_usage_json: string;
	model_attempts_json: string;
	diagnostics_json: string;
	failure_json: string | null;
	created_at_utc: string;
	updated_at_utc: string;
}

export class GenerationRunStatusUnreadableError extends Error {
	readonly code = "generation_run_status_unreadable";

	constructor(params: GenerationRunParams, cause: unknown) {
		super(
			`Generation run status for active region ${params.active_region_id} on ${params.publication_date} fails its contract on read-back`,
			{ cause },
		);
		this.name = "GenerationRunStatusUnreadableError";
	}
}

function parseStoredJson(value: string): unknown {
	return JSON.parse(value) as unknown;
}

function parseCurrentV2GenerationRunStatusRow(
	row: GenerationRunStatusRow,
): CurrentV2GenerationRunProjection {
	return CurrentV2GenerationRunProjectionSchema.parse({
		contract_version: row.contract_version,
		active_region_id: row.active_region_id,
		publication_date: row.publication_date,
		state: row.state,
		current_step: row.current_step,
		completed_steps: parseStoredJson(row.completed_steps_json),
		model_usage: parseStoredJson(row.model_usage_json),
		model_attempts: parseStoredJson(row.model_attempts_json),
		diagnostics: parseStoredJson(row.diagnostics_json),
		failure: row.failure_json === null ? null : parseStoredJson(row.failure_json),
		created_at_utc: row.created_at_utc,
		updated_at_utc: row.updated_at_utc,
	});
}

function parseCurrentV1GenerationRunStatusRow(
	row: GenerationRunStatusRow,
): CurrentV1GenerationRunProjection {
	return CurrentV1GenerationRunProjectionSchema.parse({
		contract_version: row.contract_version,
		active_region_id: row.active_region_id,
		publication_date: row.publication_date,
		state: row.state,
		current_step: row.current_step,
		completed_steps: parseStoredJson(row.completed_steps_json),
		model_usage: parseStoredJson(row.model_usage_json),
		diagnostics: parseStoredJson(row.diagnostics_json),
		failure: row.failure_json === null ? null : parseStoredJson(row.failure_json),
		created_at_utc: row.created_at_utc,
		updated_at_utc: row.updated_at_utc,
	});
}

function parseLegacyGenerationRunStatusRow(
	row: GenerationRunStatusRow,
): LegacyGenerationRunProjection {
	return LegacyGenerationRunProjectionSchema.parse({
		active_region_id: row.active_region_id,
		publication_date: row.publication_date,
		state: row.state,
		current_step: row.current_step,
		completed_steps: parseStoredJson(row.completed_steps_json),
		model_usage: parseStoredJson(row.model_usage_json),
		diagnostics: parseStoredJson(row.diagnostics_json),
		failure: row.failure_json === null ? null : parseStoredJson(row.failure_json),
		created_at_utc: row.created_at_utc,
		updated_at_utc: row.updated_at_utc,
	});
}

export function parseGenerationRunStatusRow(
	row: GenerationRunStatusRow,
	params: GenerationRunParams,
): GenerationRunProjection {
	try {
		if (row.contract_version === CURRENT_GENERATION_RUN_CONTRACT_VERSION) {
			return parseCurrentV2GenerationRunStatusRow(row);
		}
		if (row.contract_version === PREVIOUS_CURRENT_GENERATION_RUN_CONTRACT_VERSION) {
			return parseCurrentV1GenerationRunStatusRow(row);
		}
		if (row.contract_version === null) {
			return parseLegacyGenerationRunStatusRow(row);
		}
		throw new Error(`Unknown generation run contract version ${row.contract_version}`);
	} catch (cause) {
		throw new GenerationRunStatusUnreadableError(params, cause);
	}
}

export function isCurrentGenerationRunProjection(
	projection: GenerationRunProjection,
): projection is CurrentGenerationRunProjection {
	return "contract_version" in projection;
}

export function isCurrentV2GenerationRunProjection(
	projection: GenerationRunProjection,
): projection is CurrentV2GenerationRunProjection {
	return (
		"contract_version" in projection &&
		projection.contract_version === CURRENT_GENERATION_RUN_CONTRACT_VERSION
	);
}
