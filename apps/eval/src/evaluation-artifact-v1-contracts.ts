import { createHash } from "node:crypto";
import { z } from "zod";

export const V1_PRODUCTION_MODEL_STEPS = [
	"main_story_write",
	"main_story_copyedit",
	"announcements_write",
	"announcements_copyedit",
] as const;

export const V1ProductionModelStepSchema = z.enum(V1_PRODUCTION_MODEL_STEPS);
export type V1ProductionModelStep = z.infer<typeof V1ProductionModelStepSchema>;

export const V1Sha256HashSchema = z.string().regex(/^[0-9a-f]{64}$/u);

const V1NonBlankStringSchema = z.string().trim().min(1);
const V1RecordedAdapterConfigSchema = z.strictObject({ adapter: z.literal("recorded") });
const V1LmStudioAdapterConfigSchema = z.strictObject({
	adapter: z.literal("lmstudio"),
	model: V1NonBlankStringSchema,
	sampling: z.strictObject({
		temperature: z.number().finite().min(0).max(2),
		top_p: z.number().finite().min(0).max(1),
		top_k: z.number().int().nonnegative(),
	}),
	reasoning_effort: z.enum(["provider_default", "none", "minimal", "low", "medium", "high", "xhigh"]),
});
const V1HostedAdapterConfigSchema = z.strictObject({
	adapter: z.literal("openai_compatible_hosted"),
	provider: V1NonBlankStringSchema,
	model: V1NonBlankStringSchema,
	billing: z.strictObject({
		method: z.literal("calculated"),
		input_usd_per_million_tokens: z.number().finite().nonnegative(),
		output_usd_per_million_tokens: z.number().finite().nonnegative(),
		pricing_reference: V1NonBlankStringSchema,
	}),
});

export const V1ModelAdapterConfigSchema = z.discriminatedUnion("adapter", [
	V1RecordedAdapterConfigSchema,
	V1LmStudioAdapterConfigSchema,
	V1HostedAdapterConfigSchema,
]);

export const V1EvalConfigSchema = z.strictObject({
	production_steps: z.strictObject({
		main_story_write: V1ModelAdapterConfigSchema,
		main_story_copyedit: V1ModelAdapterConfigSchema,
		announcements_write: V1ModelAdapterConfigSchema,
		announcements_copyedit: V1ModelAdapterConfigSchema,
	}),
});
export type V1EvalConfig = z.infer<typeof V1EvalConfigSchema>;

export const V1TokenUsageSchema = z.discriminatedUnion("measurement", [
	z.strictObject({
		measurement: z.literal("reported"),
		input_tokens: z.int().nonnegative(),
		output_tokens: z.int().nonnegative(),
		total_tokens: z.int().nonnegative(),
	}).refine((usage) => usage.total_tokens === usage.input_tokens + usage.output_tokens, {
		message: "total_tokens must equal input_tokens plus output_tokens",
	}),
	z.strictObject({ measurement: z.literal("unavailable") }),
]);

export const V1ExternalBillingSchema = z.discriminatedUnion("classification", [
	z.strictObject({ classification: z.literal("none"), amount_usd: z.literal(0), reason: z.enum(["recorded_replay", "local_inference"]) }),
	z.strictObject({ classification: z.literal("provider_reported"), amount_usd: z.number().finite().nonnegative() }),
	z.strictObject({ classification: z.literal("calculated"), amount_usd: z.number().finite().nonnegative(), pricing_reference: V1NonBlankStringSchema }),
	z.strictObject({ classification: z.literal("unavailable"), reason: z.literal("provider_did_not_report_cost") }),
]);

const V1AnnouncementSchema = z.strictObject({
	title: z.string().min(1),
	summary: z.string().min(1),
});

const V1MainStorySchema = z.strictObject({
	headline: z.string().min(1),
	lede: z.string().min(1),
	body: z.string().min(1),
	image: z.strictObject({
		url: z.string(),
		caption: z.string(),
		credit: z.string().optional(),
	}).optional(),
});

export const V1MainStoryProductSchema = z.strictObject({
	title: z.string().min(1),
	subtitle: z.string().min(1),
	main_story: V1MainStorySchema,
});

export const V1AnnouncementsWriterOutputSchema = z.strictObject({
	announcements: z.array(V1AnnouncementSchema),
});

const V1AnnouncementInternalIdSchema = z.string().regex(/^announcement-[1-9]\d*$/u);
export const V1AnnouncementsCopyeditOutputSchema = z.strictObject({
	announcements: z.array(V1AnnouncementSchema.extend({ id: V1AnnouncementInternalIdSchema })),
});

export type V1MainStoryProduct = z.infer<typeof V1MainStoryProductSchema>;
export type V1AnnouncementsProduct = z.infer<typeof V1AnnouncementsWriterOutputSchema>;
export type V1AnnouncementsCopyeditOutput = z.infer<typeof V1AnnouncementsCopyeditOutputSchema>;
export type V1WriterOutput = V1MainStoryProduct | V1AnnouncementsProduct;

const V1PreparedMessageSchema = z.strictObject({
	id: z.string(),
	ts: z.int().min(-8_640_000_000_000_000).max(8_640_000_000_000_000),
	author_name: z.string(),
	author_id: z.string(),
	text: z.string(),
});

export const V1PreparedEvidenceSchema = z.strictObject({
	active_region_id: z.string().regex(/^[1-9]\d{0,9}$/u),
	publication_date: z.iso.date(),
	raw_count: z.int().nonnegative(),
	after_filter_count: z.int().nonnegative(),
	after_burst_count: z.int().nonnegative(),
	final_count: z.int().nonnegative(),
	drop_stats: z.strictObject({
		empty_after_trim: z.int().nonnegative(),
		too_short: z.int().nonnegative(),
		burst_merged: z.int().nonnegative(),
		sampling_dropped: z.int().nonnegative(),
	}),
	messages: z.array(V1PreparedMessageSchema),
}).superRefine((evidence, context) => {
	if (evidence.after_filter_count > evidence.raw_count) context.addIssue({ code: "custom", path: ["after_filter_count"], message: "after_filter_count cannot exceed raw_count" });
	if (evidence.after_burst_count > evidence.after_filter_count) context.addIssue({ code: "custom", path: ["after_burst_count"], message: "after_burst_count cannot exceed after_filter_count" });
	if (evidence.final_count > evidence.after_burst_count) context.addIssue({ code: "custom", path: ["final_count"], message: "final_count cannot exceed after_burst_count" });
	if (evidence.final_count !== evidence.messages.length) context.addIssue({ code: "custom", path: ["messages"], message: "messages length must equal final_count" });
	if (evidence.raw_count - evidence.after_filter_count !== evidence.drop_stats.empty_after_trim + evidence.drop_stats.too_short) context.addIssue({ code: "custom", path: ["drop_stats"], message: "filter drop statistics must equal raw_count minus after_filter_count" });
	if (evidence.after_filter_count - evidence.after_burst_count !== evidence.drop_stats.burst_merged) context.addIssue({ code: "custom", path: ["drop_stats", "burst_merged"], message: "burst_merged must equal after_filter_count minus after_burst_count" });
	if (evidence.after_burst_count - evidence.final_count !== evidence.drop_stats.sampling_dropped) context.addIssue({ code: "custom", path: ["drop_stats", "sampling_dropped"], message: "sampling_dropped must equal after_burst_count minus final_count" });
});

export type V1PreparedEvidence = z.infer<typeof V1PreparedEvidenceSchema>;

function canonical(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonical);
	if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]));
	return value;
}

function sha256Json(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const V1_OUTPUT_SCHEMAS = {
	main_story_write: V1MainStoryProductSchema,
	main_story_copyedit: V1MainStoryProductSchema,
	announcements_write: V1AnnouncementsWriterOutputSchema,
	announcements_copyedit: V1AnnouncementsCopyeditOutputSchema,
} satisfies Record<V1ProductionModelStep, z.ZodType>;

const V1_OUTPUT_CONTRACT_PROVENANCE = V1_PRODUCTION_MODEL_STEPS.map((productionStep) => {
	const canonicalSchema = z.json().parse(canonical(z.toJSONSchema(V1_OUTPUT_SCHEMAS[productionStep])));
	return Object.freeze({ production_step: productionStep, canonical_schema: canonicalSchema, schema_sha256: sha256Json(canonicalSchema) });
}) as ReadonlyArray<{ readonly production_step: V1ProductionModelStep; readonly canonical_schema: z.infer<ReturnType<typeof z.json>>; readonly schema_sha256: string }>;

export function v1OutputContractProvenance(): typeof V1_OUTPUT_CONTRACT_PROVENANCE {
	return structuredClone(V1_OUTPUT_CONTRACT_PROVENANCE);
}
