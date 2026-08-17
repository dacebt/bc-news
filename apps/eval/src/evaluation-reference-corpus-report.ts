import type { AnyLoadedEvaluationReferenceCorpus } from "./evaluation-reference-corpus";

function referenceCounts(entry: AnyLoadedEvaluationReferenceCorpus["entries"][number]): string {
	const reference = entry.reference;
	return [
		`claims=${reference.claims.length}`,
		`events=${reference.events.length}`,
		`ambiguities=${reference.ambiguities.length}`,
		`noteworthy=${reference.noteworthy_candidates.length}`,
		`entities=${reference.entities.length}`,
		`numbers=${reference.numbers.length}`,
	].join(" ");
}

function sourceLabel(corpus: AnyLoadedEvaluationReferenceCorpus): string {
	return "commit_sha" in corpus.sourceReference
		? `${corpus.sourceReference.commit_sha}:${corpus.sourceReference.path}`
		: `local-data:${corpus.sourceReference.path} sha256=${corpus.sourceReference.sha256}`;
}

export function formatEvaluationReferenceCorpusReport(corpus: AnyLoadedEvaluationReferenceCorpus): string {
	const rawTotal = corpus.entries.reduce((total, entry) => total + entry.fixture.messages.length, 0);
	const preparedTotal = corpus.entries.reduce((total, entry) => total + entry.preparedEvidence.messages.length, 0);
	const coverage = [...new Set(corpus.manifest.fixtures.flatMap(({ variation_tags }) => variation_tags))];
	return [
		`Evaluation reference corpus v${corpus.manifest.version}: ${corpus.manifest.id}`,
		`Source: ${sourceLabel(corpus)}`,
		`Fixtures: ${corpus.entries.length}`,
		`Messages: raw=${rawTotal} prepared=${preparedTotal}`,
		`Variation coverage: ${coverage.join(", ")}`,
		...corpus.entries.map((entry) => [
			`${entry.manifestEntry.ordinal}. ${entry.manifestEntry.id}`,
			`date=${entry.fixture.evidence_date}`,
			`raw=${entry.fixture.messages.length}`,
			`prepared=${entry.preparedEvidence.messages.length}`,
			referenceCounts(entry),
			`variations=${entry.manifestEntry.variation_tags.join(",")}`,
		].join(" | ")),
	].join("\n");
}
