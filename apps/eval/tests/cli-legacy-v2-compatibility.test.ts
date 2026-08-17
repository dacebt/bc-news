import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { buildEvaluationScorecardV2 } from "../src/evaluation-scorecard-builder-v2";
import { runEvalCliApplication } from "../src/cli";
import { loadEvaluationScorecardInput as loadEvaluationScorecardInputV2 } from "../src/evaluation-scorecard-input-v2";
import { createEvaluationScorecardArtifact } from "../src/evaluation-scorecard-store";
import {
	buildControlledEvaluationScorecardInputV2,
	initializeControlledEvaluationRepository,
} from "../src/evaluation-scorecard-verifier-controlled";

async function invokeCli(argv: readonly string[], currentDirectory: string, appDirectory: string): Promise<string> {
	let output = "";
	await runEvalCliApplication({
		argv,
		currentDirectory,
		appDirectory,
		environment: { INIT_CWD: currentDirectory },
		writeOutput: (text) => { output += text; },
	});
	return output;
}

async function createGeneratedLegacyScorecard(root: string): Promise<{ currentDirectory: string; appDirectory: string; resultsDirectory: string; scorecardId: string }> {
	const repositoryRoot = join(root, "repository");
	const appDirectory = join(repositoryRoot, "apps/eval");
	const resultsDirectory = "apps/eval/generated-legacy-scorecards";
	const { manifestPath, codeCommit } = await initializeControlledEvaluationRepository(repositoryRoot);
	const declaration = await buildControlledEvaluationScorecardInputV2(repositoryRoot, manifestPath, {
		directory: "apps/eval/generated-legacy-scorecard-evidence",
		codeCommit,
	});
	const artifact = buildEvaluationScorecardV2(
		await loadEvaluationScorecardInputV2(declaration.declarationPath, repositoryRoot),
		{ id: "generated-legacy-scorecard", createdAt: declaration.createdAt },
	);
	await mkdir(join(repositoryRoot, resultsDirectory), { recursive: true });
	await createEvaluationScorecardArtifact(join(repositoryRoot, resultsDirectory, `${artifact.id}.json`), artifact, repositoryRoot);
	return { currentDirectory: repositoryRoot, appDirectory, resultsDirectory, scorecardId: artifact.id };
}

test("shows generated V2 scorecards from explicit legacy directories with freshness", async () => {
	const generated = await createGeneratedLegacyScorecard(await mkdtemp(join(tmpdir(), "bc-news-cli-v2-scorecard-")));
	const output = await invokeCli(
		["scorecard", "show", generated.scorecardId, "--results-dir", generated.resultsDirectory],
		generated.currentDirectory,
		generated.appDirectory,
	);
	expect(output).toContain(`Evaluation scorecard v2: ${generated.scorecardId}`);
	expect(output).toContain("Evaluated code:");
	expect(output).toContain("freshness=");
}, 60_000);
