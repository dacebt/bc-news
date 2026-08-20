import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { writeControlledRepositoryReferenceCorpus } from "./evaluation-reference-corpus-controlled";
import { evaluationRepositoryHead } from "./evaluation-repository-reference";
export { buildControlledEvaluationScorecardInputV4, buildControlledLocalScorecard } from "./evaluation-scorecard-verifier-controlled-current";
export { buildControlledEvaluationScorecardInputV2 } from "./evaluation-scorecard-verifier-controlled-legacy-v2";
import {
	git,
	repositoryPath,
} from "./evaluation-scorecard-verifier-controlled-support";
import {
	gatewayRequestHashesForStep,
	gatewayRequestSha256,
	gatewayRequestSha256s,
} from "./evaluation-scorecard-verifier-support";
export { gatewayRequestHashesForStep, gatewayRequestSha256, gatewayRequestSha256s };
export async function initializeControlledEvaluationRepository(root: string): Promise<{ manifestPath: string; codeCommit: string }> {
	await mkdir(root, { recursive: true });
	await git(root, "init", "-b", "main");
	await git(root, "config", "user.email", "scorecard-verifier@example.invalid");
	await git(root, "config", "user.name", "Scorecard Verifier");
	const { manifestPath, corpusRoot } = await writeControlledRepositoryReferenceCorpus(root);
	await git(root, "add", repositoryPath(root, corpusRoot));
	await git(root, "commit", "-m", "Add controlled evaluation corpus");
	return { manifestPath, codeCommit: await evaluationRepositoryHead(root) };
}
export async function advanceControlledEvaluationRepository(repositoryRoot: string, ordinal: number): Promise<string> {
	const markerPath = join(repositoryRoot, `controlled-advance-${String(ordinal)}.txt`);
	await writeFile(markerPath, `advance ${String(ordinal)}\n`, "utf8");
	await git(repositoryRoot, "add", repositoryPath(repositoryRoot, markerPath));
	await git(repositoryRoot, "commit", "-m", `Advance controlled evaluation repository ${String(ordinal)}`);
	return evaluationRepositoryHead(repositoryRoot);
}
