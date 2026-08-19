import { z } from "zod";
import { GenerationRunParamsSchema, type GenerationRunParams } from "@bc-news/contracts";
import {
	EditorialDiagnosticSchema,
	PersistedModelUsageRecordSchema,
	PRODUCTION_MODEL_STEPS,
	type EditorialDiagnostic,
	type ModelUsageRecord,
	type ProductionModelStep,
} from "@bc-news/generation-core";

export const GENERATION_STEPS = [
	"prepare-evidence",
	"main_story_write",
	"main_story_copyedit",
	"announcements_write",
	"announcements_copyedit",
	"validate-edition",
	"publish-edition",
] as const;

export type GenerationStep = (typeof GENERATION_STEPS)[number];

const GenerationStepSchema = z.enum(GENERATION_STEPS);
const FailureSchema = z.strictObject({
	step: z.union([GenerationStepSchema, z.enum(["configure-generation-run", "launch-generation-run"])]),
	code: z.string().min(1),
	message: z.string().min(1),
});

const UtcTimestampSchema = z.iso.datetime({ offset: false });

export const GenerationRunProjectionSchema = z
	.strictObject({
		...GenerationRunParamsSchema.shape,
		state: z.enum(["queued", "running", "complete", "errored"]),
		current_step: GenerationStepSchema.nullable(),
		completed_steps: z.array(GenerationStepSchema),
		model_usage: z.array(PersistedModelUsageRecordSchema),
		diagnostics: z.array(EditorialDiagnosticSchema),
		failure: FailureSchema.nullable(),
		created_at_utc: UtcTimestampSchema,
		updated_at_utc: UtcTimestampSchema,
	})
	.superRefine((projection, context) => {
		if ((projection.state === "running") !== (projection.current_step !== null)) {
			context.addIssue({ code: "custom", message: "running state requires a current step" });
		}
		if ((projection.state === "errored") !== (projection.failure !== null)) {
			context.addIssue({ code: "custom", message: "errored state requires a failure" });
		}
		if (
			projection.completed_steps.some((step, index) => step !== GENERATION_STEPS[index])
		) {
			context.addIssue({ code: "custom", message: "completed steps must be an ordered prefix" });
		}
		if (
			projection.state === "running" &&
			projection.current_step !== GENERATION_STEPS[projection.completed_steps.length]
		) {
			context.addIssue({ code: "custom", message: "current step must follow completed steps" });
		}
		if (
			projection.state === "complete" &&
			projection.completed_steps.length !== GENERATION_STEPS.length
		) {
			context.addIssue({ code: "custom", message: "complete state requires all generation steps" });
		}
		const expectedProductionSteps = projection.completed_steps.filter(
			(step): step is ProductionModelStep =>
				PRODUCTION_MODEL_STEPS.includes(step as ProductionModelStep),
		);
		if (
			projection.model_usage.length !== expectedProductionSteps.length ||
			projection.model_usage.some(
				(record, index) => record.production_step !== expectedProductionSteps[index],
			)
		) {
			context.addIssue({ code: "custom", message: "model usage must match completed model steps" });
		}
		let previousDiagnosticStep = -1;
		for (const diagnostic of projection.diagnostics) {
			const stepIndex = PRODUCTION_MODEL_STEPS.indexOf(diagnostic.production_step);
			if (!projection.completed_steps.includes(diagnostic.production_step)) {
				context.addIssue({ code: "custom", message: "diagnostics require their completed production step" });
			}
			if (stepIndex < previousDiagnosticStep) {
				context.addIssue({ code: "custom", message: "diagnostics must follow production step order" });
			}
			previousDiagnosticStep = stepIndex;
		}
	});

export type GenerationRunProjection = z.infer<typeof GenerationRunProjectionSchema>;
export type GenerationRunFailure = NonNullable<GenerationRunProjection["failure"]>;

interface GenerationRunStatusRow {
	active_region_id: string;
	publication_date: string;
	state: string;
	current_step: string | null;
	completed_steps_json: string;
	model_usage_json: string;
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

function parseRow(row: GenerationRunStatusRow, params: GenerationRunParams): GenerationRunProjection {
	try {
		return GenerationRunProjectionSchema.parse({
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
	} catch (cause) {
		throw new GenerationRunStatusUnreadableError(params, cause);
	}
}

export async function readGenerationRunStatus(
	db: D1Database,
	params: GenerationRunParams,
): Promise<GenerationRunProjection | undefined> {
	const row = await db
		.prepare(
			`SELECT active_region_id, publication_date, state, current_step,
			        completed_steps_json, model_usage_json, diagnostics_json, failure_json,
			        created_at_utc, updated_at_utc
			 FROM generation_run_status
			 WHERE active_region_id = ?1 AND publication_date = ?2`,
		)
		.bind(params.active_region_id, params.publication_date)
		.first<GenerationRunStatusRow>();
	return row === null ? undefined : parseRow(row, params);
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
				active_region_id, publication_date, state, current_step,
				completed_steps_json, model_usage_json, diagnostics_json, failure_json,
				created_at_utc, updated_at_utc
			) VALUES (?1, ?2, 'queued', NULL, '[]', '[]', '[]', NULL, ?3, ?3)
			ON CONFLICT (active_region_id, publication_date) DO NOTHING`,
		)
		.bind(params.active_region_id, params.publication_date, nowUtc)
		.run();
	return result.meta.changes === 1;
}

async function replaceProjection(
	db: D1Database,
	current: GenerationRunProjection,
	next: GenerationRunProjection,
): Promise<void> {
	GenerationRunProjectionSchema.parse(next);
	if (current.state === "complete" || current.state === "errored") {
		const isExactTerminalReplay =
			current.state === next.state &&
			current.current_step === next.current_step &&
			JSON.stringify(current.completed_steps) === JSON.stringify(next.completed_steps) &&
			JSON.stringify(current.model_usage) === JSON.stringify(next.model_usage) &&
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
			(record, index) => JSON.stringify(next.model_usage[index]) !== JSON.stringify(record),
		)
	) {
		throw new Error("Generation run model usage cannot regress or replace completed records");
	}
	if (
		next.diagnostics.length < current.diagnostics.length ||
		current.diagnostics.some(
			(diagnostic, index) => JSON.stringify(next.diagnostics[index]) !== JSON.stringify(diagnostic),
		)
	) {
		throw new Error("Generation run diagnostics cannot regress or replace retained findings");
	}
	const result = await db
		.prepare(
			`UPDATE generation_run_status
			 SET state = ?3, current_step = ?4, completed_steps_json = ?5,
			     model_usage_json = ?6, diagnostics_json = ?7, failure_json = ?8, updated_at_utc = ?9
			 WHERE active_region_id = ?1 AND publication_date = ?2 AND state = ?10`,
		)
		.bind(
			next.active_region_id,
			next.publication_date,
			next.state,
			next.current_step,
			JSON.stringify(next.completed_steps),
			JSON.stringify(next.model_usage),
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

async function requireProjection(
	db: D1Database,
	params: GenerationRunParams,
): Promise<GenerationRunProjection> {
	const projection = await readGenerationRunStatus(db, params);
	if (projection === undefined) throw new Error("Generation run status row is absent");
	return projection;
}

export async function recordGenerationRunProgress(
	db: D1Database,
	params: GenerationRunParams,
	progress: {
		currentStep: GenerationStep;
		completedSteps: readonly GenerationStep[];
		modelUsage: readonly ModelUsageRecord[];
		diagnostics: readonly EditorialDiagnostic[];
	},
	nowUtc: string,
): Promise<void> {
	const current = await requireProjection(db, params);
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
	diagnostics: readonly EditorialDiagnostic[],
	nowUtc: string,
): Promise<void> {
	const current = await requireProjection(db, params);
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
	const current = await requireProjection(db, params);
	await replaceProjection(db, current, {
		...current,
		state: "errored",
		current_step: null,
		failure,
		updated_at_utc: nowUtc,
	});
}
