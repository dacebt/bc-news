import { z } from "zod";

export const TimestampMillisecondsSchema = z.int()
	.min(-8_640_000_000_000_000)
	.max(8_640_000_000_000_000);

export type TimestampMilliseconds = z.infer<typeof TimestampMillisecondsSchema>;
