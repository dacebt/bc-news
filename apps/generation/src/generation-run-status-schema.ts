import { z } from "zod";
import { GenerationRunParamsSchema, type GenerationRunParams } from "@bc-news/contracts";
import {
	EditorialDiagnosticSchema,
	FinalProductDiagnosticCodeSchema,
	PersistedModelUsageRecordSchema,
} from "@bc-news/generation-core";

export const CURRENT_GENERATION_RUN_CONTRACT_VERSION = "current_v1";

export const GENERATION_STEPS = [
	"prepare-evidence",
	"main_story_write",
	"announcements_write",
	"validate-edition",
	"publish-edition",
] as const;

export const LEGACY_GENERATION_STEPS = [
	"prepare-evidence",
	"main_story_write",
	"main_story_copyedit",
	"announcements_write",
	"announcements_copyedit",
	"validate-edition",
	"publish-edition",
] as const;

const CURRENT_PRODUCTION_MODEL_STEPS = [
	"main_story_write",
	"announcements_write",
] as const;

const LEGACY_PRODUCTION_MODEL_STEPS = [
	"main_story_write",
	"main_story_copyedit",
	"announcements_write",
	"announcements_copyedit",
] as const;

const LEGACY_COPYEDIT_STEPS = [
	"main_story_copyedit",
	"announcements_copyedit",
] as const;

const LEGACY_PRESERVATION_DIAGNOSTIC_CODES = [
	"announcement_count",
	"announcement_identity",
	"field_shape",
	"paragraph_count",
	"quoted_span",
	"numeric_literal",
	"protected_markdown",
	"protected_value",
] as const;

export type GenerationStep = (typeof GENERATION_STEPS)[number];
export type LegacyGenerationStep = (typeof LEGACY_GENERATION_STEPS)[number];

const GenerationStepSchema = z.enum(GENERATION_STEPS);
const LegacyGenerationStepSchema = z.enum(LEGACY_GENERATION_STEPS);
const CurrentProductionModelStepSchema = z.enum(CURRENT_PRODUCTION_MODEL_STEPS);
const LegacyProductionModelStepSchema = z.enum(LEGACY_PRODUCTION_MODEL_STEPS);
const LegacyCopyeditStepSchema = z.enum(LEGACY_COPYEDIT_STEPS);
const LegacyPreservationDiagnosticCodeSchema = z.enum(LEGACY_PRESERVATION_DIAGNOSTIC_CODES);
const UtcTimestampSchema = z.iso.datetime({ offset: false });

const CurrentPersistedModelUsageRecordSchema = PersistedModelUsageRecordSchema.omit({
	production_step: true,
}).extend({
	production_step: CurrentProductionModelStepSchema,
});

const LegacyPersistedModelUsageRecordSchema = PersistedModelUsageRecordSchema.omit({
	production_step: true,
}).extend({
	production_step: LegacyProductionModelStepSchema,
});

const LegacyPreservationDiagnosticSchema = z.strictObject({
	kind: z.literal("preservation"),
	production_step: LegacyCopyeditStepSchema,
	code: LegacyPreservationDiagnosticCodeSchema,
	message: z.string().min(1),
});

const LegacyFinalProductDiagnosticSchema = z.strictObject({
	kind: z.literal("final_product"),
	production_step: LegacyCopyeditStepSchema,
	code: FinalProductDiagnosticCodeSchema,
	message: z.string().min(1),
});

const CurrentEditorialDiagnosticSchema = EditorialDiagnosticSchema;
const LegacyEditorialDiagnosticSchema = z.discriminatedUnion("kind", [
	LegacyPreservationDiagnosticSchema,
	LegacyFinalProductDiagnosticSchema,
]);

const CurrentFailureSchema = z.strictObject({
	step: z.union([GenerationStepSchema, z.enum(["configure-generation-run", "launch-generation-run"])]),
	code: z.string().min(1),
	message: z.string().min(1),
});

const LegacyFailureSchema = z.strictObject({
	step: z.union([LegacyGenerationStepSchema, z.enum(["configure-generation-run", "launch-generation-run"])]),
	code: z.string().min(1),
	message: z.string().min(1),
});

function validateProjection(
	projection: {
		state: "queued" | "running" | "complete" | "errored";
		current_step: string | null;
		completed_steps: readonly string[];
		model_usage: readonly { production_step: string }[];
		diagnostics: readonly { production_step: string }[];
		failure: unknown;
	},
	context: z.RefinementCtx,
	allSteps: readonly string[],
	productionSteps: readonly string[],
): void {
	if ((projection.state === "running") !== (projection.current_step !== null)) {
		context.addIssue({ code: "custom", message: "running state requires a current step" });
	}
	if ((projection.state === "errored") !== (projection.failure !== null)) {
		context.addIssue({ code: "custom", message: "errored state requires a failure" });
	}
	if (projection.completed_steps.some((step, index) => step !== allSteps[index])) {
		context.addIssue({ code: "custom", message: "completed steps must be an ordered prefix" });
	}
	if (
		projection.state === "running" &&
		projection.current_step !== allSteps[projection.completed_steps.length]
	) {
		context.addIssue({ code: "custom", message: "current step must follow completed steps" });
	}
	if (projection.state === "complete" && projection.completed_steps.length !== allSteps.length) {
		context.addIssue({ code: "custom", message: "complete state requires all generation steps" });
	}
	const expectedProductionSteps = projection.completed_steps.filter((step): step is string =>
		productionSteps.includes(step),
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
		const stepIndex = productionSteps.indexOf(diagnostic.production_step);
		if (!projection.completed_steps.includes(diagnostic.production_step)) {
			context.addIssue({ code: "custom", message: "diagnostics require their completed production step" });
		}
		if (stepIndex < previousDiagnosticStep) {
			context.addIssue({ code: "custom", message: "diagnostics must follow production step order" });
		}
		previousDiagnosticStep = stepIndex;
	}
}

export const CurrentGenerationRunProjectionSchema = z
	.strictObject({
		contract_version: z.literal(CURRENT_GENERATION_RUN_CONTRACT_VERSION),
		...GenerationRunParamsSchema.shape,
		state: z.enum(["queued", "running", "complete", "errored"]),
		current_step: GenerationStepSchema.nullable(),
		completed_steps: z.array(GenerationStepSchema),
		model_usage: z.array(CurrentPersistedModelUsageRecordSchema),
		diagnostics: z.array(CurrentEditorialDiagnosticSchema),
		failure: CurrentFailureSchema.nullable(),
		created_at_utc: UtcTimestampSchema,
		updated_at_utc: UtcTimestampSchema,
	})
	.superRefine((projection, context) => {
		validateProjection(projection, context, GENERATION_STEPS, CURRENT_PRODUCTION_MODEL_STEPS);
	});

export const LegacyGenerationRunProjectionSchema = z
	.strictObject({
		...GenerationRunParamsSchema.shape,
		state: z.enum(["queued", "running", "complete", "errored"]),
		current_step: LegacyGenerationStepSchema.nullable(),
		completed_steps: z.array(LegacyGenerationStepSchema),
		model_usage: z.array(LegacyPersistedModelUsageRecordSchema),
		diagnostics: z.array(LegacyEditorialDiagnosticSchema),
		failure: LegacyFailureSchema.nullable(),
		created_at_utc: UtcTimestampSchema,
		updated_at_utc: UtcTimestampSchema,
	})
	.superRefine((projection, context) => {
		validateProjection(
			projection,
			context,
			LEGACY_GENERATION_STEPS,
			LEGACY_PRODUCTION_MODEL_STEPS,
		);
	});

export const GenerationRunProjectionSchema = z.union([
	CurrentGenerationRunProjectionSchema,
	LegacyGenerationRunProjectionSchema,
]);

export type CurrentGenerationRunProjection = z.infer<typeof CurrentGenerationRunProjectionSchema>;
export type LegacyGenerationRunProjection = z.infer<typeof LegacyGenerationRunProjectionSchema>;
export type GenerationRunProjection = z.infer<typeof GenerationRunProjectionSchema>;
export type CurrentEditorialDiagnostic = z.infer<typeof CurrentEditorialDiagnosticSchema>;
export type GenerationRunFailure = NonNullable<CurrentGenerationRunProjection["failure"]>;

export interface GenerationRunStatusRow {
	contract_version: string | null;
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

function parseCurrentGenerationRunStatusRow(
	row: GenerationRunStatusRow,
): CurrentGenerationRunProjection {
	return CurrentGenerationRunProjectionSchema.parse({
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
			return parseCurrentGenerationRunStatusRow(row);
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
