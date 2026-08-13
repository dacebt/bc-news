import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PRODUCTION_MODEL_STEPS, type ProductionModelStep } from "@bc-news/generation-core";
import { runEvalCliApplication } from "./cli";
import { evaluateBenchmarkCommand } from "./evaluation-benchmark-command";
import type { V7BenchmarkRun, V8BenchmarkRun } from "./evaluation-artifact";
import { canonical } from "./evaluation-artifact-schemas";
import { loadEvaluationReferenceCorpus, type LoadedEvaluationReferenceCorpusEntry } from "./evaluation-reference-corpus";
import { evaluationFreshness, evaluationRepositoryHead, readRepositorySource } from "./evaluation-repository-reference";
import { buildEvaluationScorecard } from "./evaluation-scorecard-builder";
import { loadEvaluationScorecardInput } from "./evaluation-scorecard-input";
import { formatEvaluationScorecardReport } from "./evaluation-scorecard-report";
import { createEvaluationScorecardArtifact, evaluationScorecardFreshness, loadEvaluationScorecardArtifact } from "./evaluation-scorecard-store";
import { startRecordLoopbackServer } from "./record-loopback-server";

type JsonObject = Record<string, unknown>;
const execFileAsync = promisify(execFile);

function json(value: object): string { return `${JSON.stringify(value, null, 2)}\n`; }
function repositoryPath(root: string, path: string): string { return relative(root, path).split(sep).join("/"); }
function assertProof(condition: boolean, message: string): asserts condition { if (!condition) throw new Error(message); }
async function git(root: string, ...args: string[]): Promise<string> {
	const { stdout } = await execFileAsync("git", ["-C", root, ...args], { encoding: "utf8" });
	return stdout.trim();
}

function hash(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function verifierConfiguration(gateway: boolean): JsonObject {
	return {
		configurations: [{ production_steps: Object.fromEntries(PRODUCTION_MODEL_STEPS.map((step) => [step, {
			...(gateway ? {
				adapter: "cloudflare_ai_gateway",
				gateway: { selection: "named", id: "controlled-scorecard" },
				model: `openai/${step}`,
			} : {
				adapter: "openai_compatible_hosted",
				provider: "repository_loopback",
				model: `scorecard/${step}`,
				billing: { method: "calculated", input_usd_per_million_tokens: 0, output_usd_per_million_tokens: 0, pricing_reference: "repository scorecard proof" },
			}),
		}])) }],
		repetition_count: 1,
		transport_retry_limit: 0,
	};
}

function claimTemplate(entry: LoadedEvaluationReferenceCorpusEntry): { proposition: string; referenceId: string; relation: "supports" | "supports_status_qualified" | "unresolved"; grounding: "grounded" | "indeterminate"; body: string } {
	const statusRecord = entry.reference.claims[0] ?? entry.reference.events[0];
	if (statusRecord !== undefined) {
		const kind = entry.reference.claims[0] === statusRecord ? "claim" : "event";
		if (statusRecord.status === "established") {
			const proposition = statusRecord.supporting_witnesses[0]!.excerpt;
			return { proposition, referenceId: `${kind}:${statusRecord.id}`, relation: "supports", grounding: "grounded", body: `Source record states: ${proposition} 😀` };
		}
		if (statusRecord.status === "contested") {
			const body = `Source accounts are contested: ${statusRecord.supporting_witnesses[0]!.excerpt} ${statusRecord.opposing_witnesses[0]!.excerpt}`;
			return { proposition: body, referenceId: `${kind}:${statusRecord.id}`, relation: "supports_status_qualified", grounding: "grounded", body };
		}
		const body = `Source accounts leave this unresolved: ${statusRecord.unresolved_witnesses[0]!.excerpt}`;
		return { proposition: body, referenceId: `${kind}:${statusRecord.id}`, relation: "unresolved", grounding: "indeterminate", body };
	}
	const ambiguity = entry.reference.ambiguities[0];
	if (ambiguity !== undefined) {
		const body = `Source accounts leave this unresolved: ${ambiguity.witnesses[0]!.excerpt}`;
		return { proposition: body, referenceId: `ambiguity:${ambiguity.id}`, relation: "unresolved", grounding: "indeterminate", body };
	}
	const noteworthy = entry.reference.noteworthy_candidates[0]!;
	const proposition = noteworthy.witnesses[0]!.excerpt;
	return { proposition, referenceId: `noteworthy:${noteworthy.id}`, relation: "supports", grounding: "grounded", body: `Source record notes: ${proposition}` };
}

function controlledOutputs(entry: LoadedEvaluationReferenceCorpusEntry): Record<ProductionModelStep, string> {
	const sourceClaim = claimTemplate(entry);
	const story = { title: "Regional Notes", subtitle: "Source record", main_story: { headline: "Source record", lede: "Codex-reviewed source evidence.", body: sourceClaim.body } };
	const noteworthy = entry.reference.noteworthy_candidates[0];
	const announcements = noteworthy === undefined ? [] : [{ title: "Regional notice", summary: noteworthy.witnesses[0]!.excerpt }];
	return {
		main_story_write: JSON.stringify(story),
		main_story_copyedit: JSON.stringify(story),
		announcements_write: JSON.stringify({ announcements }),
		announcements_copyedit: JSON.stringify({ announcements: announcements.map((announcement, index) => ({ id: `announcement-${String(index + 1)}`, ...announcement })) }),
	};
}

function outputIdentity(run: V7BenchmarkRun | V8BenchmarkRun, entry: LoadedEvaluationReferenceCorpusEntry, invocation: V7BenchmarkRun["trials"][number]["invocations"][number], manifestId: string): JsonObject {
	assertProof(invocation.transport === "succeeded" && invocation.parse.state === "succeeded", "Controlled invocation did not parse successfully");
	assertProof(invocation.completion.text !== null, "Controlled parsed invocation has no textual completion");
	const runtime = run.runtime_evidence.find(({ invocation_id }) => invocation_id === invocation.id);
	assertProof(runtime?.state === "captured", `Controlled invocation ${invocation.id} lacks runtime evidence`);
	const trial = run.trials.find(({ id }) => id === runtime.trial_id)!;
	const identity = {
		benchmark_run_id: run.id, benchmark_run_version: run.version, code_commit_sha: run.provenance.code.commit_sha,
		prepared_evidence_identity_sha256: run.prepared_evidence.identity_sha256, corpus_manifest_id: manifestId,
		corpus_fixture_id: entry.manifestEntry.id, config_identity: invocation.config_identity,
		trial_id: trial.id, repetition: trial.repetition, invocation_id: invocation.id,
		production_step: invocation.production_step, invocation_ordinal: invocation.ordinal,
		request_sha256: invocation.request_sha256, completion_text_sha256: hash(invocation.completion.text),
		parsed_output_sha256: hash(JSON.stringify(canonical(invocation.parse.output))),
		runtime_evidence_sha256: hash(JSON.stringify(canonical(runtime.evidence))),
	};
	if (run.version === 7) return identity;
	const gatewayRequest = run.gateway_requests.find(({ invocation_id }) => invocation_id === invocation.id);
	assertProof(gatewayRequest !== undefined, `Controlled invocation ${invocation.id} lacks Gateway-request evidence`);
	return { ...identity, gateway_request_sha256: hash(JSON.stringify(canonical(gatewayRequest))) };
}

function span(pointer: string, excerpt: string): JsonObject { return { json_pointer: pointer, start_utf16: 0, end_utf16: excerpt.length, excerpt }; }

function annotation(entry: LoadedEvaluationReferenceCorpusEntry, output: JsonObject, step: ProductionModelStep, ordinal: number): JsonObject {
	const sourceClaim = claimTemplate(entry); const storyRole = step.startsWith("main_story"); const noteworthy = entry.reference.noteworthy_candidates[0];
	const excerpt = storyRole ? sourceClaim.body : noteworthy?.witnesses[0]?.excerpt;
	const claim = excerpt === undefined ? [] : [{
		id: `observed-claim-${String(ordinal)}`, proposition: storyRole ? sourceClaim.proposition : excerpt, atomic_proposition: true,
		spans: [span(storyRole ? "/main_story/body" : "/announcements/0/summary", excerpt)],
		references: [{ reference_id: storyRole ? sourceClaim.referenceId : `noteworthy:${noteworthy!.id}`, relation: storyRole ? sourceClaim.relation : "supports" }],
		grounding: storyRole ? sourceClaim.grounding : "grounded", attribution_requirement: storyRole ? "required" : "not_required", attribution: storyRole ? "present" : "not_applicable",
		rationale: "Codex bound the exact output span to the cited fixture reference.", uncertainty: "low",
	}];
	return {
		annotation_id: `annotation-${entry.manifestEntry.id}-${step}`, output, factual_claim_inventory_complete: true, factual_claims: claim,
		event_coverage: entry.reference.events.map((event) => storyRole && sourceClaim.referenceId === `event:${event.id}`
			? { event_id: event.id, assessment: "covered", spans: [span("/main_story/body", sourceClaim.body)], rationale: "The exact story span communicates this source event.", uncertainty: "low" }
			: { event_id: event.id, assessment: "not_covered", spans: [], rationale: "This controlled output does not cover the source event.", uncertainty: "low" }),
		announcement_relevance: storyRole ? { state: "not_applicable" } : noteworthy === undefined ? { state: "assessed", announcements: [] }
			: { state: "assessed", announcements: [{ announcement_index: 0, assessment: "relevant", noteworthy_reference_ids: [`noteworthy:${noteworthy.id}`], rationale: "The exact summary communicates the cited candidate.", uncertainty: "low" }] },
	};
}

function review(entry: LoadedEvaluationReferenceCorpusEntry, output: JsonObject, step: ProductionModelStep): JsonObject {
	return { review_id: `review-${entry.manifestEntry.id}-${step}`, output, criteria: ["coherence", "usefulness", "newsworthiness", "voice"].map((criterion) => ({ criterion, assessment: "meets", rationale: `Codex assessed ${criterion} against rubric version 2.`, uncertainty: "low" })) };
}

export async function initializeControlledEvaluationRepository(root: string, corpusSource: string): Promise<{ manifestPath: string; codeCommit: string }> {
	await mkdir(root, { recursive: true });
	await git(root, "init", "-b", "main");
	await git(root, "config", "user.email", "scorecard-verifier@example.invalid");
	await git(root, "config", "user.name", "Scorecard Verifier");
	const corpusDestination = join(root, "packages/fixtures/evaluation-corpus");
	await mkdir(dirname(corpusDestination), { recursive: true });
	await cp(corpusSource, corpusDestination, { recursive: true });
	await git(root, "add", "packages/fixtures/evaluation-corpus");
	await git(root, "commit", "-m", "Add controlled evaluation corpus");
	return { manifestPath: join(corpusDestination, "manifest.json"), codeCommit: await evaluationRepositoryHead(root) };
}

export async function buildControlledEvaluationScorecardInput(root: string, manifestPath: string, options: { directory?: string; codeCommit?: string; gateway?: boolean } = {}): Promise<{ declarationPath: string; createdAt: string; sourceCommit: string }> {
	const directory = join(root, options.directory ?? "evidence/scorecard");
	const corpus = await loadEvaluationReferenceCorpus(manifestPath, root);
	const resultsDirectory = join(directory, "benchmark-results"); const configPath = join(directory, "benchmark.config.json");
	await mkdir(resultsDirectory, { recursive: true }); await writeFile(configPath, json(verifierConfiguration(options.gateway === true)), "utf8");
	const codeCommit = options.codeCommit ?? await evaluationRepositoryHead(root);
	const runs: Array<{ run: V7BenchmarkRun | V8BenchmarkRun; path: string; entry: LoadedEvaluationReferenceCorpusEntry }> = [];
	let gatewayOrdinal = 0;
	const originalFetch = globalThis.fetch;
	try {
		for (const entry of corpus.entries) {
			const retainedOutputs = controlledOutputs(entry);
			if (options.gateway === true) {
				globalThis.fetch = (_input, init) => {
					const body = typeof init?.body === "string" ? JSON.parse(init.body) as { model?: unknown } : undefined;
					const step = typeof body?.model === "string" ? body.model.split("/")[1] as ProductionModelStep : undefined;
					assertProof(step !== undefined && PRODUCTION_MODEL_STEPS.includes(step), "Controlled Gateway request omitted its production step");
					gatewayOrdinal += 1;
					return Promise.resolve(new Response(JSON.stringify({
						id: `controlled-provider-response-${String(gatewayOrdinal)}`,
						object: "chat.completion",
						model: body!.model,
						choices: [{ index: 0, message: { role: "assistant", content: retainedOutputs[step], refusal: null, annotations: [] }, finish_reason: "stop", logprobs: null }],
						usage: { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 },
						gatewayMetadata: { keySource: "Unified" },
					}), { headers: { "content-type": "application/json", "cf-aig-log-id": `controlled-gateway-log-${String(gatewayOrdinal)}` } }));
				};
				const result = await evaluateBenchmarkCommand({ fixturePath: join(root, entry.evidencePath), configPath, resultsDirectory, environment: { CLOUDFLARE_ACCOUNT_ID: "controlled-account", CLOUDFLARE_API_TOKEN: "controlled-token" }, sourceProvenance: { repository: "bc-news", commit_sha: codeCommit, dirty: false } });
				assertProof(result.benchmark.version === 8, "Controlled Gateway scorecard benchmark must be V8");
				runs.push({ run: result.benchmark, path: result.path, entry });
				continue;
			}
			const server = await startRecordLoopbackServer(Object.fromEntries(PRODUCTION_MODEL_STEPS.map((step) => [`scorecard/${step}`, retainedOutputs[step]])));
			try {
				const result = await evaluateBenchmarkCommand({ fixturePath: join(root, entry.evidencePath), configPath, resultsDirectory, environment: { HOSTED_MODEL_BASE_URL: server.baseUrl, HOSTED_MODEL_API_KEY: "record-loopback-proof" }, sourceProvenance: { repository: "bc-news", commit_sha: codeCommit, dirty: false } });
				assertProof(result.benchmark.version === 7, "Controlled scorecard benchmark must remain V7");
				runs.push({ run: result.benchmark, path: result.path, entry });
			} finally { await server.close(); }
		}
	} finally {
		globalThis.fetch = originalFetch;
	}
	const latestCompletion = Math.max(...runs.map(({ run }) => Date.parse(run.completed_at!)));
	const annotatedAt = new Date(latestCompletion + 1).toISOString(); const reviewedAt = new Date(latestCompletion + 2).toISOString(); const createdAt = new Date(latestCompletion + 3).toISOString();
	const outputs = runs.flatMap(({ run, entry }) => run.trials.flatMap(({ invocations }) => invocations.filter((invocation) => invocation.transport === "succeeded" && invocation.parse.state === "succeeded").map((invocation) => ({ entry, step: invocation.production_step, identity: outputIdentity(run, entry, invocation, corpus.manifest.id) }))));
	const annotations = { version: 2, id: `annotations-${options.directory?.replaceAll("/", "-") ?? "controlled"}`, protocol: { id: "bc-news-output-annotation", version: 2 }, annotator: { id: "codex", kind: "codex" }, annotated_at: annotatedAt, outputs: outputs.map(({ entry, identity, step }, index) => annotation(entry, identity, step, index + 1)) };
	const reviews = { version: 2, id: `reviews-${options.directory?.replaceAll("/", "-") ?? "controlled"}`, rubric: { id: "bc-news-editorial-qualitative", version: 2 }, reviewer: { id: "codex", kind: "codex" }, reviewed_at: reviewedAt, reviews: outputs.map(({ entry, identity, step }) => review(entry, identity, step)) };
	const annotationPath = join(directory, "annotations.json"); const reviewPath = join(directory, "reviews.json");
	await Promise.all([writeFile(annotationPath, json(annotations), "utf8"), writeFile(reviewPath, json(reviews), "utf8")]);
	const declarationPath = join(directory, "scorecard-input.json");
	const declaration = {
		version: 2, id: `controlled-${options.directory?.replaceAll("/", "-") ?? "scorecard"}-input`, corpus: { manifest_path: repositoryPath(root, manifestPath) },
		configuration_identity: runs[0]!.run.declaration.configurations[0]!.identity,
		runs: runs.map(({ run, path, entry }, index) => ({ ordinal: index + 1, corpus_fixture_id: entry.manifestEntry.id, benchmark_run_id: run.id, path: repositoryPath(root, path) })),
		annotations: { path: repositoryPath(root, annotationPath), bundle_id: annotations.id },
		qualitative_reviews: { path: repositoryPath(root, reviewPath), bundle_id: reviews.id },
	};
	await writeFile(declarationPath, json(declaration), "utf8");
	await git(root, "add", repositoryPath(root, directory));
	await git(root, "commit", "-m", `Add ${options.directory ?? "controlled scorecard"} evidence`);
	return { declarationPath, createdAt, sourceCommit: await evaluationRepositoryHead(root) };
}

async function invokeCli(argv: readonly string[], repositoryRoot: string, appDirectory: string): Promise<string> {
	let output = "";
	await runEvalCliApplication({ argv, currentDirectory: repositoryRoot, appDirectory, environment: { INIT_CWD: repositoryRoot }, writeOutput: (text) => { output += text; } });
	return output;
}

export async function verifyEvaluationScorecards(temporaryRoot?: string): Promise<string> {
	const root = temporaryRoot ?? await mkdtemp(join(tmpdir(), "bc-news-evaluation-scorecards-")); const cleanup = temporaryRoot === undefined;
	try {
		const repositoryRoot = join(root, "repository");
		const corpusSource = resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/fixtures/evaluation-corpus");
		const { manifestPath, codeCommit } = await initializeControlledEvaluationRepository(repositoryRoot, corpusSource);
		await git(repositoryRoot, "checkout", "-b", "evidence");
		const controlled = await buildControlledEvaluationScorecardInput(repositoryRoot, manifestPath, { codeCommit, gateway: true });
		const input = await loadEvaluationScorecardInput(controlled.declarationPath, repositoryRoot);
		const artifact = buildEvaluationScorecard(input, { id: "controlled-evaluation-scorecard", createdAt: controlled.createdAt });
		const serialized = json(artifact);
		for (const forbidden of ["source_payloads", "base64", "declaration_sha256", "benchmark_run_sha256", "reference_sha256"]) assertProof(!serialized.includes(forbidden), `Current scorecard retained forbidden byte ownership field ${forbidden}`);
		assertProof(artifact.version === 2 && artifact.sources.annotations.annotator_kind === "codex" && artifact.scorecards.length === 4, "Current scorecard contract or Codex provenance is missing");
		assertProof(artifact.scorecards.every((role, index) => role.production_step === PRODUCTION_MODEL_STEPS[index]), "Scorecard role roster or order changed");
		assertProof(artifact.sources.benchmark_runs.length === 12 && artifact.sources.benchmark_runs.every(({ ordinal }, index) => ordinal === index + 1), "Scorecard source roster or order changed");
		assertProof(artifact.sources.benchmark_runs.every((source) => "benchmark_run_version" in source && source.benchmark_run_version === 8 && source.gateway_request_sha256s.length === 4), "Gateway scorecard sources omitted exact V8 request provenance");
		assertProof(artifact.scorecards.every(({ scorecard_context }) => scorecard_context.state === "identified" && JSON.stringify(scorecard_context.projection.corpus_source_reference) === JSON.stringify(input.corpus.sourceReference)), "Scorecard semantic context omitted the corpus source commit and path");
		assertProof(artifact.scorecards.every(({ scorecard_context }) => scorecard_context.state === "identified" && scorecard_context.projection.gateway_request_hashes?.length === 12), "Gateway scorecard context omitted ordered request provenance hashes");
		const annotationKeys = new Set(input.annotations.outputs.map(({ output }) => JSON.stringify(output))); const reviewKeys = new Set(input.reviews.reviews.map(({ output }) => JSON.stringify(output)));
		assertProof(annotationKeys.size === reviewKeys.size && [...annotationKeys].every((key) => reviewKeys.has(key)), "Scorecard annotation and review output linkage changed");
		for (const role of artifact.scorecards) {
			assertProof(role.sample_counts.declared_trial_count === 12 && role.sample_counts.annotated_output_count === 12 && role.sample_counts.reviewed_output_count === 12, `${role.production_step} exact sample denominators changed`);
			assertProof(role.rates.length === 6 && role.rates.every((rate) => rate.denominator === rate.sample_count && (rate.state === "not_applicable" || (rate.interval.lower <= rate.value && rate.value <= rate.interval.upper))), `${role.production_step} rate denominators or Wilson intervals changed`);
			assertProof(role.distributions.length === 6 && role.distributions.every((distribution) => distribution.sample_count === distribution.observed_sample_count + distribution.unavailable_sample_count && (distribution.summary.state === "unavailable" || (distribution.summary.min <= distribution.summary.median && distribution.summary.median <= distribution.summary.max && distribution.summary.min <= distribution.summary.mean && distribution.summary.mean <= distribution.summary.max))), `${role.production_step} distribution accounting changed`);
			assertProof(role.qualitative.length === 4 && role.qualitative.every(({ sample_count, counts }) => sample_count === counts.meets + counts.partly_meets + counts.does_not_meet + counts.uncertain), `${role.production_step} qualitative denominator changed`);
		}
		const results = join(root, "results"); await mkdir(results);
		await createEvaluationScorecardArtifact(join(results, `${artifact.id}.json`), artifact, repositoryRoot);
		const loaded = await loadEvaluationScorecardArtifact(artifact.id, results, repositoryRoot);
		assertProof(JSON.stringify(loaded) === JSON.stringify(artifact), "Stored scorecard changed after commit-backed reconstruction");
		const cliResults = join(root, "cli-results");
		const buildOutput = await invokeCli(["scorecard", "build", "--input", repositoryPath(repositoryRoot, controlled.declarationPath), "--results-dir", cliResults], repositoryRoot, resolve(dirname(fileURLToPath(import.meta.url)), ".."));
		assertProof(buildOutput.includes("Evaluation scorecard v2") && buildOutput.includes("freshness=outdated"), "Scorecard CLI build did not report commit-addressed V2 evidence");
		await git(repositoryRoot, "checkout", "main");
		assertProof((await evaluationFreshness(repositoryRoot, codeCommit)).state === "current", "Controlled checkout did not expose current freshness");
		assertProof((await loadEvaluationScorecardArtifact(artifact.id, results, repositoryRoot)).id === artifact.id, "Historical scorecard did not reopen from its evidence commit");
		await writeFile(join(repositoryRoot, "unrelated.txt"), "unrelated checkout change\n", "utf8"); await git(repositoryRoot, "add", "unrelated.txt"); await git(repositoryRoot, "commit", "-m", "Advance checkout independently");
		const freshness = await evaluationScorecardFreshness(artifact, repositoryRoot);
		assertProof(freshness.state === "outdated", "Advanced checkout did not report scorecard as outdated");
		const report = formatEvaluationScorecardReport(artifact, freshness);
		assertProof(report.includes("freshness=outdated") && report.includes("Codex annotator: codex (codex)"), "Scorecard report omitted freshness or Codex provenance");
		const cliName = (await readdir(cliResults)).find((name) => name.endsWith(".json")); assertProof(cliName !== undefined, "CLI did not create a scorecard outside the Git repository");
		const cliArtifact = JSON.parse(await readFile(join(cliResults, cliName), "utf8")) as { id: string };
		const showOutput = await invokeCli(["scorecard", "show", cliArtifact.id, "--results-dir", cliResults], repositoryRoot, resolve(dirname(fileURLToPath(import.meta.url)), ".."));
		assertProof(showOutput.includes("freshness=outdated") && showOutput.includes("Evaluation scorecard v2"), "Scorecard CLI show did not render outdated evidence after checkout advanced");
		const stored = JSON.parse(await readFile(join(results, `${artifact.id}.json`), "utf8")) as JsonObject;
		((stored.scorecards as JsonObject[])[0]!.sample_counts as JsonObject).declared_trial_count = 999;
		await writeFile(join(results, `${artifact.id}.json`), json(stored), "utf8");
		let rejected = false; try { await loadEvaluationScorecardArtifact(artifact.id, results, repositoryRoot); } catch { rejected = true; }
		assertProof(rejected, "Derived scorecard tampering was accepted");
		let missing = false; try { await readRepositorySource(repositoryRoot, { ...artifact.source_reference, path: "missing/evidence.json" }); } catch { missing = true; }
		assertProof(missing, "Missing commit path was accepted");
		return `${report}\nEVALUATION SCORECARDS VERIFIED`;
	} finally { if (cleanup) await rm(root, { recursive: true, force: true }); }
}

async function main(): Promise<void> { process.stdout.write(`${await verifyEvaluationScorecards()}\n`); }
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
