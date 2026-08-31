import { z } from "zod";
import type { GenerationRunParams } from "@bc-news/contracts";
import type { ModelUsageRecord } from "@bc-news/generation-core";
import { sameModelAttemptRecord, type CurrentModelAttemptRecord } from "./generation-run-model-attempt";
import {
	CURRENT_GENERATION_RUN_CONTRACT_VERSION,
	CurrentGenerationRunProjectionSchema,
	GENERATION_STEPS,
	isCurrentGenerationRunProjection,
	isCurrentV2GenerationRunProjection,
	parseGenerationRunStatusRow,
	type CurrentEditorialDiagnostic,
	type CurrentGenerationRunProjection,
	type GenerationRunFailure,
	type GenerationRunProjection,
	type GenerationRunStatusRow,
	type GenerationStep,
} from "./generation-run-status-schema";

const UtcTimestampSchema = z.iso.datetime({ offset: false });

export {
	CURRENT_GENERATION_RUN_CONTRACT_VERSION,
	CurrentGenerationRunProjectionSchema,
	CurrentV1GenerationRunProjectionSchema,
	CurrentV2GenerationRunProjectionSchema,
	GenerationRunProjectionSchema,
	GenerationRunStatusUnreadableError,
	GENERATION_STEPS,
	LEGACY_GENERATION_STEPS,
	LegacyGenerationRunProjectionSchema,
	PREVIOUS_CURRENT_GENERATION_RUN_CONTRACT_VERSION,
	isCurrentV2GenerationRunProjection,
} from "./generation-run-status-schema";

export type {
	CurrentEditorialDiagnostic,
	CurrentGenerationRunProjection,
	CurrentModelAttemptRecord,
	CurrentV1GenerationRunProjection,
	CurrentV2GenerationRunProjection,
	GenerationRunFailure,
	GenerationRunProjection,
	GenerationStep,
	LegacyGenerationRunProjection,
	LegacyGenerationStep,
} from "./generation-run-status-schema";

export async function readGenerationRunStatus(
	db: D1Database,
	params: GenerationRunParams,
): Promise<GenerationRunProjection | undefined> {
	const row = await db
		.prepare(
			`SELECT contract_version, active_region_id, publication_date, state, current_step,
			        completed_steps_json, model_usage_json, model_attempts_json, diagnostics_json, failure_json,
			        created_at_utc, updated_at_utc
			 FROM generation_run_status
			 WHERE active_region_id = ?1 AND publication_date = ?2`,
		)
		.bind(params.active_region_id, params.publication_date)
		.first<GenerationRunStatusRow>();
	return row === null ? undefined : parseGenerationRunStatusRow(row, params);
}

export async function queueGenerationRunStatus(
	db: D1Database,
	params: GenerationRunParams,
	nowUtc: string,
): Promise<boolean> {
	UtcTimestampSchema.parse(nowUtc);
	const result = await db
		.prepare(
			`INSERT INTO generation_run_status (
				contract_version, active_region_id, publication_date, state, current_step,
				completed_steps_json, model_usage_json, model_attempts_json, diagnostics_json, failure_json,
				created_at_utc, updated_at_utc
			) VALUES (?1, ?2, ?3, 'queued', NULL, '[]', '[]', '[]', '[]', NULL, ?4, ?4)
			ON CONFLICT (active_region_id, publication_date) DO NOTHING`,
		)
		.bind(
			CURRENT_GENERATION_RUN_CONTRACT_VERSION,
			params.active_region_id,
			params.publication_date,
			nowUtc,
		)
		.run();
	return result.meta.changes === 1;
}

function sameModelUsageRecord(
	left: CurrentGenerationRunProjection["model_usage"][number],
	right: CurrentGenerationRunProjection["model_usage"][number],
): boolean {
	return (
		left.production_step === right.production_step &&
		left.provider === right.provider &&
		left.model === right.model &&
		left.execution === right.execution &&
		JSON.stringify(left.token_usage) === JSON.stringify(right.token_usage) &&
		JSON.stringify(left.external_billing) === JSON.stringify(right.external_billing) &&
		JSON.stringify(left.request_provenance ?? null) === JSON.stringify(right.request_provenance ?? null)
	);
}

function sameDiagnostic(
	left: CurrentEditorialDiagnostic,
	right: CurrentEditorialDiagnostic,
): boolean {
	return (
		left.kind === right.kind &&
		left.production_step === right.production_step &&
		left.code === right.code &&
		left.message === right.message
	);
}

async function replaceProjection(
	db: D1Database,
	current: CurrentGenerationRunProjection,
	next: CurrentGenerationRunProjection,
): Promise<void> {
	CurrentGenerationRunProjectionSchema.parse(next);
	const currentV2 = isCurrentV2GenerationRunProjection(current) ? current : null;
	const nextV2 = isCurrentV2GenerationRunProjection(next) ? next : null;
	if (current.contract_version !== next.contract_version) {
		throw new Error("Generation run contract version cannot change in place");
	}
	if (current.state === "complete" || current.state === "errored") {
		const isExactTerminalReplay =
			current.contract_version === next.contract_version &&
			current.state === next.state &&
			current.current_step === next.current_step &&
			JSON.stringify(current.completed_steps) === JSON.stringify(next.completed_steps) &&
			JSON.stringify(current.model_usage) === JSON.stringify(next.model_usage) &&
			((currentV2 === null && nextV2 === null) ||
				(currentV2 !== null &&
					nextV2 !== null &&
					currentV2.model_attempts.length === nextV2.model_attempts.length &&
					currentV2.model_attempts.every((record, index) => {
						const nextRecord = nextV2.model_attempts[index];
						return nextRecord !== undefined && sameModelAttemptRecord(record, nextRecord);
					}))) &&
			JSON.stringify(current.diagnostics) === JSON.stringify(next.diagnostics) &&
			JSON.stringify(current.failure) === JSON.stringify(next.failure);
		if (isExactTerminalReplay) return;
		throw new Error(`Cannot transition terminal generation run status ${current.state}`);
	}
	const legalTransition =
		(current.state === "queued" && (next.state === "running" || next.state === "errored")) ||
		(current.state === "running" &&
			(next.state === "running" || next.state === "complete" || next.state === "errored"));
	if (!legalTransition) {
		throw new Error(`Illegal generation run status transition ${current.state} -> ${next.state}`);
	}
	if (
		next.completed_steps.length < current.completed_steps.length ||
		current.completed_steps.some((step, index) => next.completed_steps[index] !== step)
	) {
		throw new Error("Generation run completed steps cannot regress");
	}
	if (
		next.model_usage.length < current.model_usage.length ||
		current.model_usage.some(
			(record, index) => {
				const nextRecord = next.model_usage[index];
				return nextRecord === undefined || !sameModelUsageRecord(record, nextRecord);
			},
		)
	) {
		throw new Error("Generation run model usage cannot regress or replace completed records");
	}
	if ((currentV2 === null) !== (nextV2 === null)) {
		throw new Error("Generation run status cannot switch attempt retention modes");
	}
	if (
		currentV2 !== null &&
		nextV2 !== null &&
		(nextV2.model_attempts.length < currentV2.model_attempts.length ||
			currentV2.model_attempts.some((record, index) => {
				const nextRecord = nextV2.model_attempts[index];
				return nextRecord === undefined || !sameModelAttemptRecord(record, nextRecord);
			}))
	) {
		throw new Error("Generation run model attempts cannot regress or replace retained attempts");
	}
	if (
		next.diagnostics.length < current.diagnostics.length ||
		current.diagnostics.some(
			(diagnostic, index) => {
				const nextDiagnostic = next.diagnostics[index];
				return nextDiagnostic === undefined || !sameDiagnostic(diagnostic, nextDiagnostic);
			},
		)
	) {
		throw new Error("Generation run diagnostics cannot regress or replace retained findings");
	}
	const result = await db
		.prepare(
			`UPDATE generation_run_status
			 SET contract_version = ?3, state = ?4, current_step = ?5, completed_steps_json = ?6,
			     model_usage_json = ?7, model_attempts_json = ?8, diagnostics_json = ?9,
			     failure_json = ?10, updated_at_utc = ?11
			 WHERE active_region_id = ?1 AND publication_date = ?2 AND state = ?12`,
		)
		.bind(
			next.active_region_id,
			next.publication_date,
			next.contract_version,
			next.state,
			next.current_step,
			JSON.stringify(next.completed_steps),
			JSON.stringify(next.model_usage),
			JSON.stringify(isCurrentV2GenerationRunProjection(next) ? next.model_attempts : []),
			JSON.stringify(next.diagnostics),
			next.failure === null ? null : JSON.stringify(next.failure),
			next.updated_at_utc,
			current.state,
		)
		.run();
	if (result.meta.changes !== 1) {
		throw new Error("Generation run status update did not change exactly one row");
	}
}

async function requireCurrentProjection(
	db: D1Database,
	params: GenerationRunParams,
): Promise<CurrentGenerationRunProjection> {
	const projection = await readGenerationRunStatus(db, params);
	if (projection === undefined) throw new Error("Generation run status row is absent");
	if (!isCurrentGenerationRunProjection(projection)) {
		throw new Error("Generation run status row is legacy and cannot accept current updates");
	}
	return projection;
}

export async function recordGenerationRunProgress(
	db: D1Database,
	params: GenerationRunParams,
	progress: {
		currentStep: GenerationStep;
		completedSteps: readonly GenerationStep[];
		modelUsage: readonly ModelUsageRecord[];
		modelAttempts: readonly CurrentModelAttemptRecord[];
		diagnostics: readonly CurrentEditorialDiagnostic[];
	},
	nowUtc: string,
): Promise<void> {
	const current = await requireCurrentProjection(db, params);
	if (isCurrentV2GenerationRunProjection(current)) {
		await replaceProjection(db, current, {
			...current,
			state: "running",
			current_step: progress.currentStep,
			completed_steps: [...progress.completedSteps],
			model_usage: [...progress.modelUsage],
			model_attempts: [...progress.modelAttempts],
			diagnostics: [...progress.diagnostics],
			failure: null,
			updated_at_utc: nowUtc,
		});
		return;
	}
	await replaceProjection(db, current, {
		...current,
		state: "running",
		current_step: progress.currentStep,
		completed_steps: [...progress.completedSteps],
		model_usage: [...progress.modelUsage],
		diagnostics: [...progress.diagnostics],
		failure: null,
		updated_at_utc: nowUtc,
	});
}

export async function recordGenerationRunComplete(
	db: D1Database,
	params: GenerationRunParams,
	modelUsage: readonly ModelUsageRecord[],
	modelAttempts: readonly CurrentModelAttemptRecord[],
	diagnostics: readonly CurrentEditorialDiagnostic[],
	nowUtc: string,
): Promise<void> {
	const current = await requireCurrentProjection(db, params);
	if (isCurrentV2GenerationRunProjection(current)) {
		await replaceProjection(db, current, {
			...current,
			state: "complete",
			current_step: null,
			completed_steps: [...GENERATION_STEPS],
			model_usage: [...modelUsage],
			model_attempts: [...modelAttempts],
			diagnostics: [...diagnostics],
			failure: null,
			updated_at_utc: nowUtc,
		});
		return;
	}
	await replaceProjection(db, current, {
		...current,
		state: "complete",
		current_step: null,
		completed_steps: [...GENERATION_STEPS],
		model_usage: [...modelUsage],
		diagnostics: [...diagnostics],
		failure: null,
		updated_at_utc: nowUtc,
	});
}

export async function recordGenerationRunFailure(
	db: D1Database,
	params: GenerationRunParams,
	failure: GenerationRunFailure,
	nowUtc: string,
): Promise<void> {
	const current = await requireCurrentProjection(db, params);
	await replaceProjection(db, current, {
		...current,
		state: "errored",
		current_step: null,
		failure,
		updated_at_utc: nowUtc,
	});
}
