import type { EvidenceMessage } from "@bc-news/contracts";
import { prepareEvidence } from "@bc-news/generation-core";
import {
	HistoricalSampledPreparedEvidenceSchema,
	type HistoricalSampledPreparedEvidence,
} from "./evaluation-artifact-schemas";

const MAX_MESSAGES = 300;
const PER_BUCKET_CAP = Math.ceil(MAX_MESSAGES / 24);

function compareMessages(
	left: HistoricalSampledPreparedEvidence["messages"][number],
	right: HistoricalSampledPreparedEvidence["messages"][number],
): number {
	return left.ts - right.ts || left.id.localeCompare(right.id);
}

function fnv1a32(value: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

export function prepareHistoricalSampledEvidence(input: {
	readonly activeRegionId: string;
	readonly publicationDate: string;
	readonly messages: readonly EvidenceMessage[];
}): HistoricalSampledPreparedEvidence {
	const hygienic = prepareEvidence(input);
	const bucketCounts = new Map<number, number>();
	const sampled = hygienic.messages
		.map((message) => ({
			message,
			score: fnv1a32(`${input.activeRegionId}|${input.publicationDate}|${message.id}`),
		}))
		.sort((left, right) => left.score - right.score || compareMessages(left.message, right.message))
		.filter(({ message }) => {
			const hour = new Date(message.ts).getUTCHours();
			const count = bucketCounts.get(hour) ?? 0;
			if (count >= PER_BUCKET_CAP) return false;
			bucketCounts.set(hour, count + 1);
			return true;
		})
		.slice(0, MAX_MESSAGES)
		.map(({ message }) => message)
		.sort(compareMessages);

	return HistoricalSampledPreparedEvidenceSchema.parse({
		...hygienic,
		final_count: sampled.length,
		drop_stats: {
			...hygienic.drop_stats,
			sampling_dropped: hygienic.after_burst_count - sampled.length,
		},
		messages: sampled,
	});
}
