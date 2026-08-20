import { type EvaluationCorpusVariationTag, type EvaluationReference } from "./evaluation-reference-corpus";
import { assertProof } from "./evaluation-scorecard-verifier-support";

export interface LegacyV2ControlledDeclaration {
	readonly version: 2;
	readonly id: string;
	readonly corpus: { readonly manifest_path: string };
	readonly configuration_identity: string;
	readonly runs: ReadonlyArray<{
		readonly ordinal: number;
		readonly corpus_fixture_id: string;
		readonly benchmark_run_id: string;
		readonly path: string;
	}>;
	readonly annotations: {
		readonly path: string;
		readonly bundle_id: string;
	};
	readonly qualitative_reviews: {
		readonly path: string;
		readonly bundle_id: string;
	};
}

export interface LegacyPreparedMessage {
	readonly id: string;
	readonly ts: number;
	readonly author_id: string;
	readonly author_name: string;
	readonly text: string;
}

interface LegacyPreparedSnapshot {
	readonly active_region_id: string;
	readonly publication_date: string;
	readonly messages: readonly LegacyPreparedMessage[];
}

export interface LegacyRetainedBenchmark {
	readonly prepared_evidence: {
		readonly active_region_id: string;
		readonly publication_date: string;
		readonly snapshot: LegacyPreparedSnapshot;
	};
}

type LegacyVariationWitness = {
	readonly tag: EvaluationCorpusVariationTag;
	readonly reference_ids: readonly string[];
	readonly message_ids: readonly string[];
};

export type LegacyReferenceProjection = {
	readonly reference: EvaluationReference;
	readonly variation_tags: readonly EvaluationCorpusVariationTag[];
	readonly variation_witnesses: readonly LegacyVariationWitness[];
};

function legacyMessageById(
	messages: readonly LegacyPreparedMessage[],
	messageId: string,
): LegacyPreparedMessage {
	const message = messages.find(({ id }) => id === messageId);
	assertProof(message !== undefined, `Controlled legacy fixture is missing message ${messageId}`);
	return message;
}

export function legacyTextWitness(
	messages: readonly LegacyPreparedMessage[],
	messageId: string,
	excerpt: string,
) {
	const message = legacyMessageById(messages, messageId);
	assertProof(
		message.text.includes(excerpt),
		`Controlled legacy witness excerpt "${excerpt}" is not retained in ${messageId}`,
	);
	return { message_id: messageId, field: "text" as const, excerpt };
}

export function legacyAuthorWitness(
	messages: readonly LegacyPreparedMessage[],
	messageId: string,
	authorName?: string,
) {
	const message = legacyMessageById(messages, messageId);
	const excerpt = authorName ?? message.author_name;
	assertProof(
		message.author_name.includes(excerpt),
		`Controlled legacy author witness "${excerpt}" is not retained in ${messageId}`,
	);
	return { message_id: messageId, field: "author_name" as const, excerpt };
}

export function legacyEvidenceDate(publicationDate: string): string {
	const publication = new Date(`${publicationDate}T00:00:00.000Z`);
	assertProof(
		Number.isFinite(publication.getTime()),
		`Controlled legacy publication date is invalid: ${publicationDate}`,
	);
	publication.setUTCDate(publication.getUTCDate() - 1);
	return publication.toISOString().slice(0, 10);
}
