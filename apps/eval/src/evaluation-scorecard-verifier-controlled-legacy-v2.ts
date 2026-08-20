import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { EvaluationReferenceManifestSchema } from "./evaluation-reference-corpus";
import { legacyReferenceProjection } from "./evaluation-scorecard-verifier-controlled-legacy-v2-reference";
import {
	type LegacyRetainedBenchmark,
	type LegacyV2ControlledDeclaration,
	legacyEvidenceDate,
} from "./evaluation-scorecard-verifier-controlled-legacy-v2-support";
import {
	CONTROLLED_REFERENCE_CORPUS_DIRECTORY,
	LEGACY_V2_SCORECARD_EVIDENCE_ROOT,
	git,
	rebaseLegacyV2Path,
	repositoryPath,
} from "./evaluation-scorecard-verifier-controlled-support";
import { assertProof, json } from "./evaluation-scorecard-verifier-support";

async function writeLegacyV2ReferenceCorpus(
	repositoryRoot: string,
	evidenceRoot: string,
	declaration: LegacyV2ControlledDeclaration,
): Promise<void> {
	const corpusRoot = join(repositoryRoot, CONTROLLED_REFERENCE_CORPUS_DIRECTORY);
	await rm(corpusRoot, { recursive: true, force: true });
	const fixtures = [];
	for (const run of declaration.runs) {
		const copiedRunPath = join(
			repositoryRoot,
			rebaseLegacyV2Path(run.path, repositoryPath(repositoryRoot, evidenceRoot)),
		);
		const retained = JSON.parse(await readFile(copiedRunPath, "utf8")) as LegacyRetainedBenchmark;
		const snapshot = retained.prepared_evidence.snapshot;
		assertProof(
			snapshot.active_region_id === retained.prepared_evidence.active_region_id,
			`Controlled legacy benchmark ${run.benchmark_run_id} detached its active region`,
		);
		const evidencePath = join(corpusRoot, "evidence", `${run.corpus_fixture_id}.json`);
		const referencePath = join(corpusRoot, "references", `${run.corpus_fixture_id}.json`);
		const referenceProjection = legacyReferenceProjection(run.corpus_fixture_id, snapshot.messages);
		await mkdir(dirname(evidencePath), { recursive: true });
		await writeFile(evidencePath, json({
			active_region_id: snapshot.active_region_id,
			evidence_date: legacyEvidenceDate(snapshot.publication_date),
			messages: snapshot.messages,
		}), "utf8");
		await mkdir(dirname(referencePath), { recursive: true });
		await writeFile(referencePath, json(referenceProjection.reference), "utf8");
		fixtures.push({
			ordinal: run.ordinal,
			id: run.corpus_fixture_id,
			evidence_path: `${CONTROLLED_REFERENCE_CORPUS_DIRECTORY}/evidence/${run.corpus_fixture_id}.json`,
			reference_path: `${CONTROLLED_REFERENCE_CORPUS_DIRECTORY}/references/${run.corpus_fixture_id}.json`,
			variation_tags: referenceProjection.variation_tags,
			variation_witnesses: referenceProjection.variation_witnesses,
		});
	}
	const manifestPath = join(corpusRoot, "manifest.json");
	await mkdir(dirname(manifestPath), { recursive: true });
	await writeFile(manifestPath, json(EvaluationReferenceManifestSchema.parse({
		version: 2,
		id: "bcn-evaluation-reference-corpus-v2",
		fixtures,
	})), "utf8");
}

export async function buildControlledEvaluationScorecardInputV2(
	repositoryRoot: string,
	manifestPath: string,
	options: { directory: string; codeCommit: string },
): Promise<{ declarationPath: string; createdAt: string }> {
	void manifestPath;
	void options.codeCommit;
	const evidenceRoot = join(repositoryRoot, options.directory);
	await cp(LEGACY_V2_SCORECARD_EVIDENCE_ROOT, evidenceRoot, { recursive: true });
	const declarationPath = join(evidenceRoot, "scorecard-input.json");
	const declaration = JSON.parse(
		await readFile(declarationPath, "utf8"),
	) as LegacyV2ControlledDeclaration;
	await writeLegacyV2ReferenceCorpus(repositoryRoot, evidenceRoot, declaration);
	const targetDirectory = repositoryPath(repositoryRoot, evidenceRoot);
	await writeFile(declarationPath, json({
		...declaration,
		runs: declaration.runs.map((run) => ({
			...run,
			path: rebaseLegacyV2Path(run.path, targetDirectory),
		})),
		annotations: {
			...declaration.annotations,
			path: rebaseLegacyV2Path(declaration.annotations.path, targetDirectory),
		},
		qualitative_reviews: {
			...declaration.qualitative_reviews,
			path: rebaseLegacyV2Path(declaration.qualitative_reviews.path, targetDirectory),
		},
	}), "utf8");
	const review = JSON.parse(await readFile(join(evidenceRoot, "reviews.json"), "utf8")) as { reviewed_at: string };
	const createdAt = new Date(Date.parse(review.reviewed_at) + 1).toISOString();
	await git(
		repositoryRoot,
		"add",
		repositoryPath(repositoryRoot, join(repositoryRoot, CONTROLLED_REFERENCE_CORPUS_DIRECTORY)),
	);
	await git(repositoryRoot, "add", repositoryPath(repositoryRoot, evidenceRoot));
	await git(repositoryRoot, "commit", "-m", "Add controlled scorecard v2 evidence");
	return { declarationPath, createdAt };
}
