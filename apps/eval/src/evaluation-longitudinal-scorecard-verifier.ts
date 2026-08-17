import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildEvaluationLongitudinalScorecard } from "./evaluation-longitudinal-scorecard-builder";
import {
	loadEvaluationLongitudinalInput,
	loadEvaluationLongitudinalInputAtReference,
	localSourceReferenceAtPath,
	type LoadedEvaluationLongitudinalInput,
	validateLoadedEvaluationLongitudinalInput,
} from "./evaluation-longitudinal-scorecard-input";
import { formatEvaluationLongitudinalScorecardReport } from "./evaluation-longitudinal-scorecard-report";
import {
	EvaluationLongitudinalDeclarationSchema,
	EvaluationLongitudinalScorecardArtifactSchema,
	type EvaluationLongitudinalDeclaration,
	type EvaluationLongitudinalScorecardArtifact,
} from "./evaluation-longitudinal-scorecard";
import {
	createEvaluationLongitudinalScorecardArtifact,
	evaluationLongitudinalFreshness,
	loadEvaluationLongitudinalScorecardArtifact,
} from "./evaluation-longitudinal-scorecard-store";
import { buildEvaluationScorecard } from "./evaluation-scorecard-builder";
import { loadEvaluationScorecardInput } from "./evaluation-scorecard-input";
import type { EvaluationScorecardArtifact } from "./evaluation-scorecard";
import { createEvaluationScorecardArtifact } from "./evaluation-scorecard-store";
import {
	advanceControlledEvaluationRepository,
	buildControlledLocalScorecard,
	initializeControlledEvaluationRepository,
} from "./evaluation-scorecard-verifier-controlled";

function json(value: object): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

function assertProof(condition: boolean, message: string): asserts condition {
	if (!condition) {
		throw new Error(message);
	}
}

function sha256(value: Uint8Array | string): string {
	return createHash("sha256").update(value).digest("hex");
}

function parseLongitudinalDeclaration(raw: string, path: string): EvaluationLongitudinalDeclaration {
	const result = EvaluationLongitudinalDeclarationSchema.safeParse(JSON.parse(raw) as unknown);
	assertProof(
		result.success,
		`Controlled longitudinal declaration contract rejected at ${path}: ${result.success ? "" : result.error.message}`,
	);
	return result.data;
}

function parseLongitudinalArtifact(raw: string, path: string): EvaluationLongitudinalScorecardArtifact {
	const result = EvaluationLongitudinalScorecardArtifactSchema.safeParse(JSON.parse(raw) as unknown);
	assertProof(
		result.success,
		`Controlled longitudinal artifact contract rejected at ${path}: ${result.success ? "" : result.error.message}`,
	);
	return result.data;
}

async function expectReject(label: string, operation: () => Promise<unknown>): Promise<void> {
	let rejected = false;
	try {
		await operation();
	} catch {
		rejected = true;
	}
	assertProof(rejected, label);
}

async function writeLongitudinalDeclaration(
	localDataRoot: string,
	name: string,
	scorecardPaths: readonly string[],
	scorecardIds: readonly string[],
	phases: readonly ("baseline" | "subject")[],
): Promise<string> {
	const declarationPath = join(localDataRoot, "longitudinal", `${name}.json`);
	await mkdir(dirname(declarationPath), { recursive: true });
	const scorecards = [];
	for (let index = 0; index < scorecardPaths.length; index += 1) {
		scorecards.push({
			ordinal: index + 1,
			phase: phases[index]!,
			scorecard_id: scorecardIds[index]!,
			source_reference: await localSourceReferenceAtPath(localDataRoot, scorecardPaths[index]!),
		});
	}
	await writeFile(declarationPath, json({ version: 3, id: name, scorecards }), "utf8");
	return declarationPath;
}

export async function verifyEvaluationLongitudinalScorecards(temporaryRoot?: string): Promise<string> {
	const root = temporaryRoot ?? await mkdtemp(join(tmpdir(), "bc-news-longitudinal-scorecards-"));
	const cleanup = temporaryRoot === undefined;

	try {
		const repositoryRoot = join(root, "repository");
		const localDataRoot = join(root, "apps/eval/local-data");
		const relocatedLocalDataRoot = join(root, "relocated/local-data");
		const { manifestPath, codeCommit } = await initializeControlledEvaluationRepository(repositoryRoot);

		let cursor = 0;
		let currentCodeCommit = codeCommit;
		const sources: Array<{
			artifact: EvaluationScorecardArtifact;
			path: string;
			createdCursor: number;
			sourceDeclarationPath: string;
		}> = [];
		const sourceWorkspaceRoot = join(root, "controlled-scorecard-workspaces");
		for (let ordinal = 1; ordinal <= 5; ordinal += 1) {
			const source = await buildControlledLocalScorecard(
				repositoryRoot,
				manifestPath,
				localDataRoot,
				sourceWorkspaceRoot,
				ordinal,
				cursor,
				currentCodeCommit,
			);
			sources.push(source);
			cursor = source.createdCursor;
			if (ordinal < 5) {
				currentCodeCommit = await advanceControlledEvaluationRepository(repositoryRoot, ordinal);
			}
		}

		const declarationPath = await writeLongitudinalDeclaration(
			localDataRoot,
			"controlled-longitudinal-declaration",
			sources.map(({ path }) => path),
			sources.map(({ artifact }) => artifact.id),
			["baseline", "baseline", "baseline", "subject", "subject"],
		);
		const input = await loadEvaluationLongitudinalInput(declarationPath, localDataRoot);
		const artifact = buildEvaluationLongitudinalScorecard(input, {
			id: "controlled-longitudinal-series",
			createdAt: new Date(cursor + 1).toISOString(),
		});
		const serialized = json(artifact);

		for (const forbidden of ["source_payloads", "base64", "declaration_sha256", "scorecard_sha256", "scorecard_hashes"]) {
			assertProof(
				!serialized.includes(forbidden),
				`Current longitudinal artifact retained forbidden byte ownership field ${forbidden}`,
			);
		}
		assertProof(artifact.version === 3 && artifact.roles.length === 4, "Longitudinal V3 did not retain four role histories");
		assertProof(
			artifact.roles.every((role) => role.classification.state === "context_changed"),
			"Controlled longitudinal V3 did not detect distinct evaluated-code contexts",
		);
		assertProof(
			artifact.roles.every((role) => role.context_differences.some(({ path }) => path.includes("code_provenance"))),
			"Controlled longitudinal V3 omitted evaluated-code provenance differences",
		);
		assertProof(
			artifact.roles.every(({ stable_contexts }) => stable_contexts.every((context) => (
				context.state === "identified"
					? Array.isArray(context.projection.ordered_gateway_requests)
					: true
			))),
			"Gateway provenance did not survive into stable longitudinal contexts",
		);

		const resultsDirectory = join(localDataRoot, "longitudinal-results");
		await mkdir(resultsDirectory, { recursive: true });
		await createEvaluationLongitudinalScorecardArtifact(join(resultsDirectory, `${artifact.id}.json`), artifact, {
			repositoryRoot,
			localDataRoot,
		});
		const saved = await loadEvaluationLongitudinalScorecardArtifact(artifact.id, resultsDirectory, {
			repositoryRoot,
			localDataRoot,
		});
		assertProof(saved.version === 3 && saved.id === artifact.id, "Stored longitudinal artifact did not reopen");

		const freshness = await evaluationLongitudinalFreshness(artifact, repositoryRoot);
		assertProof(
			freshness.length === 5 && freshness.every(({ scorecard_id, code }) => {
				const source = artifact.scorecard_references.find((reference) => reference.scorecard_id === scorecard_id);
				return source !== undefined
					&& code.evaluated_commit_sha === source.evaluated_code_commit_sha
					&& /^[0-9a-f]{40}$/u.test(code.checkout_commit_sha);
			}),
			"Longitudinal code freshness did not stay separate from local-data provenance",
		);
		const report = formatEvaluationLongitudinalScorecardReport(artifact, freshness);
		assertProof(
			report.includes("Source local data: longitudinal/controlled-longitudinal-declaration.json")
				&& report.includes('"evaluated_commit_sha"'),
			"Longitudinal report did not render local-data provenance distinctly from code freshness",
		);

		await cp(localDataRoot, relocatedLocalDataRoot, { recursive: true });
		const relocated = await loadEvaluationLongitudinalScorecardArtifact(
			artifact.id,
			join(relocatedLocalDataRoot, "longitudinal-results"),
			{ repositoryRoot, localDataRoot: relocatedLocalDataRoot },
		);
		assertProof(relocated.id === artifact.id, "Relocated local-data workspace did not reopen longitudinal evidence");

		const declarationReference = await localSourceReferenceAtPath(localDataRoot, declarationPath);
		await expectReject("Longitudinal declaration hash mismatch was accepted", async () => {
			await loadEvaluationLongitudinalInputAtReference(localDataRoot, { ...declarationReference, sha256: "f".repeat(64) });
		});

		const missingPath = sources[0]!.path;
		const missingBackup = `${missingPath}.bak`;
		await rename(missingPath, missingBackup);
		await expectReject("Missing local longitudinal scorecard was accepted", async () => {
			await loadEvaluationLongitudinalInput(declarationPath, localDataRoot);
		});
		await rename(missingBackup, missingPath);

		const traversalPath = join(localDataRoot, "longitudinal", "invalid-traversal.json");
		const traversalBase = parseLongitudinalDeclaration(await readFile(declarationPath, "utf8"), declarationPath);
		const traversalDeclaration: EvaluationLongitudinalDeclaration = {
			...traversalBase,
			id: "invalid-traversal",
			scorecards: traversalBase.scorecards.map((scorecard, index) => index === 0
				? { ...scorecard, source_reference: { path: "../escape.json", sha256: "a".repeat(64) } }
				: scorecard),
		};
		await writeFile(traversalPath, json(traversalDeclaration), "utf8");
		await expectReject("Traversal local source was accepted", async () => {
			await loadEvaluationLongitudinalInput(traversalPath, localDataRoot);
		});

		const outsidePath = join(root, "outside-scorecard.json");
		await writeFile(outsidePath, await readFile(sources[1]!.path, "utf8"), "utf8");
		const symlinkRelativePath = "escape/symlink-scorecard.json";
		const symlinkSha256 = sha256(await readFile(outsidePath));
		await mkdir(dirname(join(localDataRoot, symlinkRelativePath)), { recursive: true });
		await symlink(outsidePath, join(localDataRoot, symlinkRelativePath));
		const symlinkDeclarationPath = join(localDataRoot, "longitudinal", "invalid-symlink.json");
		const symlinkBase = parseLongitudinalDeclaration(await readFile(declarationPath, "utf8"), declarationPath);
		const symlinkDeclaration: EvaluationLongitudinalDeclaration = {
			...symlinkBase,
			id: "invalid-symlink",
			scorecards: symlinkBase.scorecards.map((scorecard, index) => index === 0
				? { ...scorecard, source_reference: { path: symlinkRelativePath, sha256: symlinkSha256 } }
				: scorecard),
		};
		await writeFile(symlinkDeclarationPath, json(symlinkDeclaration), "utf8");
		await expectReject("Symlink escape local source was accepted", async () => {
			await loadEvaluationLongitudinalInput(symlinkDeclarationPath, localDataRoot);
		});

		const tamperedPath = join(resultsDirectory, `${artifact.id}.json`);
		const storedArtifact = parseLongitudinalArtifact(await readFile(tamperedPath, "utf8"), tamperedPath);
		const [firstRole, secondRole, thirdRole, fourthRole] = storedArtifact.roles;
		const tampered: EvaluationLongitudinalScorecardArtifact = {
			...storedArtifact,
			roles: [
				{
					...firstRole,
					phase_count_summaries: {
						...firstRole.phase_count_summaries,
						baseline: { ...firstRole.phase_count_summaries.baseline, declared_trial_count: 999 },
					},
				},
				secondRole,
				thirdRole,
				fourthRole,
			],
		};
		await writeFile(tamperedPath, json(tampered), "utf8");
		await expectReject("Derived longitudinal tampering was accepted", async () => {
			await loadEvaluationLongitudinalScorecardArtifact(artifact.id, resultsDirectory, { repositoryRoot, localDataRoot });
		});
		await writeFile(tamperedPath, json(artifact), "utf8");

		const phaseViolationPath = await writeLongitudinalDeclaration(
			localDataRoot,
			"invalid-phase-order",
			sources.map(({ path }) => path),
			sources.map(({ artifact }) => artifact.id),
			["baseline", "subject", "baseline", "subject", "subject"],
		);
		await expectReject("Longitudinal phase partition violation was accepted", async () => {
			await loadEvaluationLongitudinalInput(phaseViolationPath, localDataRoot);
		});

		const chronologyViolationPath = await writeLongitudinalDeclaration(
			localDataRoot,
			"invalid-chronology",
			[sources[0]!.path, sources[2]!.path, sources[1]!.path, sources[3]!.path, sources[4]!.path],
			[sources[0]!.artifact.id, sources[2]!.artifact.id, sources[1]!.artifact.id, sources[3]!.artifact.id, sources[4]!.artifact.id],
			["baseline", "baseline", "baseline", "subject", "subject"],
		);
		await expectReject("Longitudinal chronology violation was accepted", async () => {
			await loadEvaluationLongitudinalInput(chronologyViolationPath, localDataRoot);
		});

		const duplicateArtifact = buildEvaluationScorecard(
			await loadEvaluationScorecardInput(sources[0]!.sourceDeclarationPath, localDataRoot),
			{ id: "controlled-scorecard-duplicate-runs", createdAt: new Date(cursor + 100).toISOString() },
		);
		const duplicatePath = join(localDataRoot, "scorecards", `${duplicateArtifact.id}.json`);
		await createEvaluationScorecardArtifact(duplicatePath, duplicateArtifact, { repositoryRoot, localDataRoot });
		const duplicateRunsPath = await writeLongitudinalDeclaration(
			localDataRoot,
			"invalid-duplicate-runs",
			[sources[0]!.path, duplicatePath, sources[2]!.path, sources[3]!.path, sources[4]!.path],
			[sources[0]!.artifact.id, duplicateArtifact.id, sources[2]!.artifact.id, sources[3]!.artifact.id, sources[4]!.artifact.id],
			["baseline", "baseline", "baseline", "subject", "subject"],
		);
		await expectReject("Pairwise-disjoint Benchmark Run ids violation was accepted", async () => {
			await loadEvaluationLongitudinalInput(duplicateRunsPath, localDataRoot);
		});

		const loadedWithoutContexts: Omit<LoadedEvaluationLongitudinalInput, "stableRoleContexts"> = {
			localDataRoot: input.localDataRoot,
			sourceReference: input.sourceReference,
			declarationPath: input.declarationPath,
			declarationBytes: input.declarationBytes,
			declaration: input.declaration,
			scorecards: input.scorecards,
		};
		const validated = validateLoadedEvaluationLongitudinalInput(loadedWithoutContexts);
		assertProof(validated.scorecards.length === 5, "Validated longitudinal input changed its roster");

		return `${report}\nEVALUATION LONGITUDINAL SCORECARDS VERIFIED`;
	} finally {
		if (cleanup) {
			await rm(root, { recursive: true, force: true });
		}
	}
}

async function main(): Promise<void> {
	process.stdout.write(`${await verifyEvaluationLongitudinalScorecards()}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	void main();
}
