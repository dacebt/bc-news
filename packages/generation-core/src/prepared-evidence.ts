import { z } from "zod";
import {
	ActiveRegionIdSchema,
	PublicationDateSchema,
	TimestampMillisecondsSchema,
} from "@bc-news/contracts";

export const PreparedMessageSchema = z.strictObject({
	id: z.string(),
	ts: TimestampMillisecondsSchema,
	author_name: z.string(),
	author_id: z.string(),
	text: z.string(),
});

export type PreparedMessage = z.infer<typeof PreparedMessageSchema>;

export const PreparedEvidenceSchema = z.strictObject({
	active_region_id: ActiveRegionIdSchema,
	publication_date: PublicationDateSchema,
	raw_count: z.int().nonnegative(),
	after_filter_count: z.int().nonnegative(),
	after_burst_count: z.int().nonnegative(),
	final_count: z.int().nonnegative(),
	drop_stats: z.strictObject({
		empty_after_trim: z.int().nonnegative(),
		too_short: z.int().nonnegative(),
		burst_merged: z.int().nonnegative(),
	}),
	messages: z.array(PreparedMessageSchema),
}).superRefine((output, context) => {
	if (output.after_filter_count > output.raw_count) {
		context.addIssue({
			code: "custom",
			path: ["after_filter_count"],
			message: "after_filter_count cannot exceed raw_count",
		});
	}
	if (output.after_burst_count > output.after_filter_count) {
		context.addIssue({
			code: "custom",
			path: ["after_burst_count"],
			message: "after_burst_count cannot exceed after_filter_count",
		});
	}
	/*
	 * Equality, not an upper bound: preparation performs hygiene only, so
	 * every message surviving burst-merge reaches the editorial capabilities.
	 * A future volume cap, per-hour quota, or sampling pass would fail here
	 * rather than quietly shrinking what the newspaper is written from.
	 */
	if (output.final_count !== output.after_burst_count) {
		context.addIssue({
			code: "custom",
			path: ["final_count"],
			message: "final_count must equal after_burst_count: preparation never drops messages after burst-merge",
		});
	}
	if (output.final_count !== output.messages.length) {
		context.addIssue({
			code: "custom",
			path: ["messages"],
			message: "messages length must equal final_count",
		});
	}

	const filteredCount = output.drop_stats.empty_after_trim + output.drop_stats.too_short;
	if (output.raw_count - output.after_filter_count !== filteredCount) {
		context.addIssue({
			code: "custom",
			path: ["drop_stats"],
			message: "filter drop statistics must equal raw_count minus after_filter_count",
		});
	}
	if (output.after_filter_count - output.after_burst_count !== output.drop_stats.burst_merged) {
		context.addIssue({
			code: "custom",
			path: ["drop_stats", "burst_merged"],
			message: "burst_merged must equal after_filter_count minus after_burst_count",
		});
	}
});

export type PreparedEvidence = z.infer<typeof PreparedEvidenceSchema>;
