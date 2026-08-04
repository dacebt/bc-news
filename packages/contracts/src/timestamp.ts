import { z } from "zod";

export const MIN_TIMESTAMP_MILLISECONDS = -8_640_000_000_000_000;
export const MAX_TIMESTAMP_MILLISECONDS = 8_640_000_000_000_000;

export const TimestampMillisecondsSchema = z.int()
	.min(MIN_TIMESTAMP_MILLISECONDS)
	.max(MAX_TIMESTAMP_MILLISECONDS);

export type TimestampMilliseconds = z.infer<typeof TimestampMillisecondsSchema>;
