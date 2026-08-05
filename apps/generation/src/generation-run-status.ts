import { z } from "zod";
import { GenerationRunParamsSchema, type GenerationRunParams } from "@bc-news/contracts";
import type { EditorialCapability, ModelUsageRecord } from "@bc-news/generation-core";

export const GENERATION_STEPS = [
	"prepare-evidence",
	"compose-main-story",
	"compose-announcements",
	"compose-packaging",
	"validate-edition",
	"publish-edition",
] as const;

export type GenerationStep = (typeof GENERATION_STEPS)[number];

const GenerationStepSchema = z.enum(GENERATION_STEPS);
const EditorialCapabilitySchema = z.enum(["main_story", "announcements", "packaging"]);
const TokenUsageSchema = z.discriminatedUnion("measurement", [
	z.strictObject({
		measurement: z.literal("reported"),
		input_tokens: z.int().nonnegative(),
		output_tokens: z.int().nonnegative(),
		total_tokens: z.int().nonnegative(),
	}).refine(
		(value) => value.total_tokens === value.input_tokens + value.output_tokens,
		"total_tokens must equal input_tokens plus output_tokens",
	),
	z.strictObject({ measurement: z.literal("unavailable") }),
]);
const ExternalBillingSchema = z.discriminatedUnion("classification", [
	z.strictObject({
		classification: z.literal("none"),
		amount_usd: z.literal(0),
		reason: z.enum(["recorded_replay", "local_inference"]),
	}),
	z.strictObject({
		classification: z.literal("provider_reported"),
		amount_usd: z.number().nonnegative(),
	}),
	z.strictObject({
		classification: z.literal("calculated"),
		amount_usd: z.number().nonnegative(),
		pricing_reference: z.string().min(1),
	}),
	z.strictObject({
		classification: z.literal("unavailable"),
		reason: z.literal("provider_did_not_report_cost"),
	}),
]);
export const ModelUsageRecordSchema = z.strictObject({
	editorial_capability: EditorialCapabilitySchema,
	provider: z.string().min(1),
	model: z.string().min(1),
	execution: z.enum(["recorded_replay", "local_inference", "hosted_inference"]),
	token_usage: TokenUsageSchema,
	external_billing: ExternalBillingSchema,
});

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
		model_usage: z.array(ModelUsageRecordSchema),
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
		const expectedCapabilities: EditorialCapability[] = [];
		if (projection.completed_steps.includes("compose-main-story")) expectedCapabilities.push("main_story");
		if (projection.completed_steps.includes("compose-announcements")) expectedCapabilities.push("announcements");
		if (projection.completed_steps.includes("compose-packaging")) expectedCapabilities.push("packaging");
		if (
			projection.model_usage.length !== expectedCapabilities.length ||
			projection.model_usage.some(
				(record, index) => record.editorial_capability !== expectedCapabilities[index],
			)
		) {
			context.addIssue({ code: "custom", message: "model usage must match completed model steps" });
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
			        completed_steps_json, model_usage_json, failure_json,
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
				completed_steps_json, model_usage_json, failure_json,
				created_at_utc, updated_at_utc
			) VALUES (?1, ?2, 'queued', NULL, '[]', '[]', NULL, ?3, ?3)
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
	const result = await db
		.prepare(
			`UPDATE generation_run_status
			 SET state = ?3, current_step = ?4, completed_steps_json = ?5,
			     model_usage_json = ?6, failure_json = ?7, updated_at_utc = ?8
			 WHERE active_region_id = ?1 AND publication_date = ?2 AND state = ?9`,
		)
		.bind(
			next.active_region_id,
			next.publication_date,
			next.state,
			next.current_step,
			JSON.stringify(next.completed_steps),
			JSON.stringify(next.model_usage),
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
		failure: null,
		updated_at_utc: nowUtc,
	});
}

export async function recordGenerationRunComplete(
	db: D1Database,
	params: GenerationRunParams,
	modelUsage: readonly ModelUsageRecord[],
	nowUtc: string,
): Promise<void> {
	const current = await requireProjection(db, params);
	await replaceProjection(db, current, {
		...current,
		state: "complete",
		current_step: null,
		completed_steps: [...GENERATION_STEPS],
		model_usage: [...modelUsage],
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
