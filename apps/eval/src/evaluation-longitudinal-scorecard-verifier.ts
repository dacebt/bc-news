import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runEvalCliApplication } from "./cli";
import {
	buildEvaluationLongitudinalScorecard,
	classifyLongitudinalEvidence,
	compareLongitudinalContexts,
	projectLongitudinalRoleContext,
} from "./evaluation-longitudinal-scorecard-builder";
import { loadEvaluationLongitudinalInput } from "./evaluation-longitudinal-scorecard-input";
import { formatEvaluationLongitudinalScorecardReport } from "./evaluation-longitudinal-scorecard-report";
import { buildEvaluationScorecard } from "./evaluation-scorecard-builder";
import { loadEvaluationScorecardInput } from "./evaluation-scorecard-input";
import { createEvaluationScorecardArtifact } from "./evaluation-scorecard-store";
import { buildControlledEvaluationScorecardInput, initializeControlledEvaluationRepository } from "./evaluation-scorecard-verifier";
import { loadEvaluationReferenceCorpus } from "./evaluation-reference-corpus";
import {
	createEvaluationLongitudinalScorecardArtifact,
	evaluationLongitudinalFreshness,
	loadEvaluationLongitudinalScorecardArtifact,
} from "./evaluation-longitudinal-scorecard-store";
import type { EvaluationScorecardArtifact } from "./evaluation-scorecard";

type JsonObject = Record<string, unknown>;
const execFileAsync = promisify(execFile);
function json(value: object): string { return `${JSON.stringify(value, null, 2)}\n`; }
function repositoryPath(root: string, path: string): string { return relative(root, path).split(sep).join("/"); }
function assertProof(condition: boolean, message: string): asserts condition { if (!condition) throw new Error(message); }
async function git(root: string, ...args: string[]): Promise<string> { const { stdout } = await execFileAsync("git", ["-C", root, ...args], { encoding: "utf8" }); return stdout.trim(); }
async function invokeCli(argv: readonly string[], repositoryRoot: string, appDirectory: string): Promise<string> {
	let output = "";
	await runEvalCliApplication({ argv, currentDirectory: repositoryRoot, appDirectory, environment: { INIT_CWD: repositoryRoot }, writeOutput: (text) => { output += text; } });
	return output;
}

async function buildCommittedScorecard(repositoryRoot: string, manifestPath: string, codeCommit: string, ordinal: number, createdCursor: number): Promise<{ artifact: EvaluationScorecardArtifact; path: string; commit: string; createdCursor: number }> {
	const controlled = await buildControlledEvaluationScorecardInput(repositoryRoot, manifestPath, { directory: `evidence/scorecard-${String(ordinal)}`, codeCommit });
	const input = await loadEvaluationScorecardInput(controlled.declarationPath, repositoryRoot);
	const created = Math.max(Date.parse(controlled.createdAt), createdCursor + 1);
	const artifact = buildEvaluationScorecard(input, { id: `controlled-scorecard-${String(ordinal)}`, createdAt: new Date(created).toISOString() });
	const path = join(repositoryRoot, "retained-scorecards", `${artifact.id}.json`); await mkdir(dirname(path), { recursive: true });
	await createEvaluationScorecardArtifact(path, artifact, repositoryRoot);
	await git(repositoryRoot, "add", repositoryPath(repositoryRoot, path)); await git(repositoryRoot, "commit", "-m", `Retain controlled scorecard ${String(ordinal)}`);
	return { artifact, path, commit: await git(repositoryRoot, "rev-parse", "HEAD"), createdCursor: created };
}

export async function verifyEvaluationLongitudinalScorecards(temporaryRoot?: string): Promise<string> {
	const root = temporaryRoot ?? await mkdtemp(join(tmpdir(), "bc-news-longitudinal-scorecards-")); const cleanup = temporaryRoot === undefined;
	try {
		const repositoryRoot = join(root, "repository");
		const corpusSource = resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/fixtures/evaluation-corpus");
		const { manifestPath, codeCommit } = await initializeControlledEvaluationRepository(repositoryRoot, corpusSource);
		await git(repositoryRoot, "checkout", "-b", "evidence");
		const sources: Array<{ artifact: EvaluationScorecardArtifact; path: string; commit: string; createdCursor: number }> = []; let cursor = 0;
		for (let ordinal = 1; ordinal <= 5; ordinal += 1) {
			const source = await buildCommittedScorecard(repositoryRoot, manifestPath, codeCommit, ordinal, cursor); sources.push(source); cursor = source.createdCursor;
		}
		const declarationPath = join(repositoryRoot, "longitudinal", "declaration.json"); await mkdir(dirname(declarationPath), { recursive: true });
		const declaration = {
			version: 2, id: "controlled-longitudinal-declaration",
			scorecards: sources.map((source, index) => ({ ordinal: index + 1, phase: index < 3 ? "baseline" : "subject", scorecard_id: source.artifact.id, source_reference: { repository: "bc-news", commit_sha: source.commit, path: repositoryPath(repositoryRoot, source.path) } })),
		};
		await writeFile(declarationPath, json(declaration), "utf8"); await git(repositoryRoot, "add", repositoryPath(repositoryRoot, declarationPath)); await git(repositoryRoot, "commit", "-m", "Add controlled longitudinal declaration");
		const input = await loadEvaluationLongitudinalInput(declarationPath, repositoryRoot);
		const artifact = buildEvaluationLongitudinalScorecard(input, { id: "controlled-longitudinal-series", createdAt: new Date(cursor + 1).toISOString() });
		const serialized = json(artifact);
		for (const forbidden of ["source_payloads", "base64", "declaration_sha256", "scorecard_sha256", "scorecard_hashes"]) assertProof(!serialized.includes(forbidden), `Current longitudinal artifact retained forbidden byte ownership field ${forbidden}`);
		assertProof(artifact.version === 2 && artifact.roles.length === 4 && artifact.roles.every(({ classification }) => classification.state === "within_baseline"), "Longitudinal V2 did not retain four unchanged role histories");
		const manifestBytes = await readFile(manifestPath, "utf8"); await writeFile(manifestPath, `${manifestBytes.trimEnd()}\n\n`, "utf8");
		await git(repositoryRoot, "add", repositoryPath(repositoryRoot, manifestPath)); await git(repositoryRoot, "commit", "-m", "Revise valid corpus source");
		const changedCorpus = await loadEvaluationReferenceCorpus(manifestPath, repositoryRoot);
		const baselineContext = projectLongitudinalRoleContext(sources[0]!.artifact, "main_story_write");
		const changedScorecard = structuredClone(sources[0]!.artifact); const changedRole = changedScorecard.scorecards[0]!;
		assertProof(changedRole.scorecard_context.state === "identified", "Controlled changed-corpus proof requires identified context");
		changedRole.scorecard_context.projection.corpus_source_reference = changedCorpus.sourceReference;
		const changedContext = projectLongitudinalRoleContext(changedScorecard, "main_story_write");
		assertProof(baselineContext.state === "identified" && changedContext.state === "identified" && baselineContext.identity !== changedContext.identity, "Changed valid corpus source commit did not change stable context identity");
		const contextDifferences = compareLongitudinalContexts([{ scorecardId: "baseline-context", ordinal: 1 }, { scorecardId: "changed-context", ordinal: 2 }], [baselineContext, changedContext]);
		assertProof(contextDifferences.some(({ path }) => path === "projection.corpus_source_reference.commit_sha"), "Corpus source commit difference was not named explicitly");
		const witness = artifact.roles[0].eligible_signal_witnesses[0]; assertProof(witness !== undefined, "Controlled classification proof lacks an eligible signal witness");
		const quietWitness = { ...witness, observed: false }; const observedWitness = { ...witness, observed: true };
		assertProof(classifyLongitudinalEvidence([baselineContext, changedContext], contextDifferences, 3, 2, [observedWitness]).state === "context_changed", "Changed corpus context did not outrank potential drift");
		assertProof(classifyLongitudinalEvidence([baselineContext], [], 2, 1, [quietWitness]).state === "insufficient_evidence", "Insufficient longitudinal branch changed");
		assertProof(classifyLongitudinalEvidence([baselineContext], [], 3, 2, [observedWitness]).state === "potential_drift", "Potential-drift longitudinal branch changed");
		assertProof(classifyLongitudinalEvidence([baselineContext], [], 3, 2, [quietWitness]).state === "within_baseline", "Within-baseline longitudinal branch changed");
		const results = join(root, "results"); await mkdir(results);
		await createEvaluationLongitudinalScorecardArtifact(join(results, `${artifact.id}.json`), artifact, repositoryRoot);
		assertProof((await loadEvaluationLongitudinalScorecardArtifact(artifact.id, results, repositoryRoot)).id === artifact.id, "Stored longitudinal artifact did not reopen");
		const cliResults = join(root, "cli-results");
		const buildOutput = await invokeCli(["longitudinal", "build", "--input", repositoryPath(repositoryRoot, declarationPath), "--results-dir", cliResults], repositoryRoot, resolve(dirname(fileURLToPath(import.meta.url)), ".."));
		assertProof(buildOutput.includes("Longitudinal evaluation scorecard series v2") && buildOutput.includes('"state": "outdated"'), "Longitudinal CLI build omitted V2 freshness evidence");
		await git(repositoryRoot, "checkout", "main");
		assertProof((await loadEvaluationLongitudinalScorecardArtifact(artifact.id, results, repositoryRoot)).id === artifact.id, "Historical longitudinal evidence did not reopen after checkout moved");
		await writeFile(join(repositoryRoot, "unrelated.txt"), "new checkout state\n", "utf8"); await git(repositoryRoot, "add", "unrelated.txt"); await git(repositoryRoot, "commit", "-m", "Advance checkout independently");
		const freshness = await evaluationLongitudinalFreshness(artifact, repositoryRoot);
		assertProof(freshness.length === 5 && freshness.every(({ code }) => code.state === "outdated"), "Longitudinal source freshness did not report outdated without rejection");
		const report = formatEvaluationLongitudinalScorecardReport(artifact, freshness);
		assertProof(report.includes('"state": "outdated"') && report.match(/Longitudinal role:/gu)?.length === 4, "Longitudinal report omitted freshness or role history");
		const resolvedCliName = (await readdir(cliResults)).find((name) => name.endsWith(".json")); assertProof(resolvedCliName !== undefined, "Longitudinal CLI did not create an external artifact");
		const cliArtifact = JSON.parse(await readFile(join(cliResults, resolvedCliName), "utf8")) as { id: string };
		const showOutput = await invokeCli(["longitudinal", "show", cliArtifact.id, "--results-dir", cliResults], repositoryRoot, resolve(dirname(fileURLToPath(import.meta.url)), ".."));
		assertProof(showOutput.includes('"state": "outdated"') && showOutput.includes("Longitudinal evaluation scorecard series v2"), "Longitudinal CLI show did not render outdated evidence after checkout advanced");
		const path = join(results, `${artifact.id}.json`); const tampered = JSON.parse(await readFile(path, "utf8")) as JsonObject;
		(((tampered.roles as JsonObject[])[0]!.phase_count_summaries as JsonObject).baseline as JsonObject).declared_trial_count = 999;
		await writeFile(path, json(tampered), "utf8"); let rejected = false;
		try { await loadEvaluationLongitudinalScorecardArtifact(artifact.id, results, repositoryRoot); } catch { rejected = true; }
		assertProof(rejected, "Derived longitudinal tampering was accepted");
		return `${report}\nEVALUATION LONGITUDINAL SCORECARDS VERIFIED`;
	} finally { if (cleanup) await rm(root, { recursive: true, force: true }); }
}

async function main(): Promise<void> { process.stdout.write(`${await verifyEvaluationLongitudinalScorecards()}\n`); }
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
