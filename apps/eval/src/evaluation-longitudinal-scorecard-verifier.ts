import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { PRODUCTION_MODEL_STEPS, type ProductionModelStep } from "@bc-news/generation-core";
import { formatEvalCliFailure, runEvalCliApplication } from "./cli";
import { canonical, evaluationConfigIdentity } from "./evaluation-artifact-schemas";
import type { V7BenchmarkRun } from "./evaluation-artifact";
import { buildControlledEvaluationScorecardInput } from "./evaluation-scorecard-verifier";
import { buildEvaluationScorecard } from "./evaluation-scorecard-builder";
import { loadEvaluationScorecardInput } from "./evaluation-scorecard-input";
import { createEvaluationScorecardArtifact } from "./evaluation-scorecard-store";
import type { EvaluationScorecardArtifact } from "./evaluation-scorecard";
import { buildEvaluationLongitudinalScorecard, projectLongitudinalRoleContext } from "./evaluation-longitudinal-scorecard-builder";
import { loadEvaluationLongitudinalInput, type LoadedEvaluationLongitudinalInput } from "./evaluation-longitudinal-scorecard-input";
import { formatEvaluationLongitudinalScorecardReport } from "./evaluation-longitudinal-scorecard-report";
import {
	EvaluationLongitudinalError,
	type EvaluationLongitudinalScorecardArtifact,
	type StableLongitudinalContext,
} from "./evaluation-longitudinal-scorecard";
import {
	createEvaluationLongitudinalScorecardArtifact,
	loadEvaluationLongitudinalScorecardArtifact,
} from "./evaluation-longitudinal-scorecard-store";

type JsonObject = Record<string, unknown>;
type ControlledMutation = "retry" | "tokens" | "tokens-touch" | "qualitative" | "sparse-ungrounded" | "all-ungrounded" | "no-copyedit-evidence" | "local-a" | "local-b";
const Z95 = 1.959963984540054;

function hash(value: string | Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

function json(value: object): string {
	return `${JSON.stringify(value, null, 2)}\n`;
}

function assertProof(condition: boolean, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function expectCode(operation: () => unknown, expected: string): Promise<void> {
	try {
		await operation();
	} catch (error) {
		if (error instanceof EvaluationLongitudinalError && error.code === expected) return;
		throw new Error(`Expected longitudinal error ${expected}, received ${error instanceof EvaluationLongitudinalError ? error.code : String(error)}`, { cause: error });
	}
	throw new Error(`Expected longitudinal error ${expected}`);
}

function canonicalIdentity(projection: object): string {
	return `longitudinal-context-${hash(JSON.stringify(canonical(projection)))}`;
}

function canonicalHash(value: object): string {
	return hash(JSON.stringify(canonical(value)));
}

function oracleWilson(numerator: number, denominator: number) {
	const proportion = numerator / denominator;
	const zSquared = Z95 * Z95;
	const scale = 1 + zSquared / denominator;
	const center = (proportion + zSquared / (2 * denominator)) / scale;
	const margin = Z95 * Math.sqrt((proportion * (1 - proportion) + zSquared / (4 * denominator)) / denominator) / scale;
	return { confidence: 0.95 as const, method: "wilson_score" as const, lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) };
}

function oracleSummary(values: readonly number[]) {
	if (values.length === 0) return { state: "unavailable" as const };
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return {
		state: "measured" as const,
		min: sorted[0]!,
		median: sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!,
		mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
		max: sorted.at(-1)!,
	};
}

function oracleContext(scorecard: EvaluationScorecardArtifact, roleIndex: number): StableLongitudinalContext {
	const role = scorecard.scorecards[roleIndex]!;
	if (role.scorecard_context.state === "unknown") return { state: "unknown", reason: "no_captured_invocation" };
	const retryLimits = new Set(scorecard.source_payloads.benchmark_runs.map(({ bytes_base64 }) => {
		const run = JSON.parse(Buffer.from(bytes_base64, "base64").toString("utf8")) as V7BenchmarkRun;
		return run.declaration.transport_retry_limit;
	}));
	assertProof(retryLimits.size === 1, "Oracle found a mixed retry policy inside one scorecard");
	const requests = new Map<string, string>();
	for (const request of role.scorecard_context.projection.request_hashes) {
		const key = `${request.run_id}\0${request.trial_id}`;
		const previous = requests.get(key);
		assertProof(previous === undefined || previous === request.request_sha256, "Oracle found differing retry request hashes");
		if (previous === undefined) requests.set(key, request.request_sha256);
	}
	const source = role.scorecard_context.projection;
	const projection = {
		scorecard_version: 1 as const,
		corpus_manifest_id: source.corpus_manifest_id,
		corpus_manifest_sha256: source.corpus_manifest_sha256,
		ordered_fixture_prepared_identities: source.fixture_prepared_identities,
		code_provenance: source.code_provenance,
		ordered_output_contract_provenance: source.output_contract_provenance,
		adapter: source.adapter,
		declared_transport_retry_limit: [...retryLimits][0]!,
		ordered_requests: [...requests.values()].map((request_sha256, index) => ({ observation_ordinal: index + 1, request_sha256 })),
		normalized_execution_context: source.execution_context,
	};
	return { state: "identified", identity: canonicalIdentity(projection), projection };
}

function proveIndependentOracle(input: LoadedEvaluationLongitudinalInput, artifact: EvaluationLongitudinalScorecardArtifact): void {
	for (const [roleIndex, step] of PRODUCTION_MODEL_STEPS.entries()) {
		const actual = artifact.roles[roleIndex]!;
		assertProof(actual.production_step === step, `Role order changed at ${step}`);
		const expectedContexts = input.scorecards.map(({ artifact: scorecard }) => oracleContext(scorecard, roleIndex));
		assertProof(isDeepStrictEqual(actual.stable_contexts, expectedContexts), `${step} stable contexts differ from the independent source-byte oracle`);
		const baselineIndexes = input.scorecards.flatMap(({ descriptor }, index) => descriptor.phase === "baseline" ? [index] : []);
		const subjectIndexes = input.scorecards.flatMap(({ descriptor }, index) => descriptor.phase === "subject" ? [index] : []);
		const sourceRoles = input.scorecards.map(({ artifact: scorecard }) => scorecard.scorecards[roleIndex]!);
		for (const [rateIndex, history] of actual.rate_histories.entries()) {
			for (const [phaseName, indexes] of [["baseline", baselineIndexes], ["subject", subjectIndexes]] as const) {
				const phase = history[phaseName];
				const measurements = indexes.map((index) => sourceRoles[index]!.rates[rateIndex]!);
				const numerator = measurements.reduce((sum, measurement) => sum + measurement.numerator, 0);
				const denominator = measurements.reduce((sum, measurement) => sum + measurement.denominator, 0);
				assertProof(phase.source_pack_count === indexes.length && phase.pool.numerator === numerator && phase.pool.denominator === denominator, `${step}/${history.metric}/${phaseName} was not pooled from counts`);
				if (denominator > 0) {
					assertProof(phase.pool.state === "measured" && isDeepStrictEqual(phase.pool.interval, oracleWilson(numerator, denominator)), `${step}/${history.metric}/${phaseName} Wilson interval differs from oracle`);
				} else assertProof(phase.pool.state === "not_applicable", `${step}/${history.metric}/${phaseName} fabricated a zero-denominator measurement`);
			}
			const eligible = sourceRoles.every((role) => role.rates[rateIndex]!.state === "measured" && role.rates[rateIndex]!.denominator > 0);
			if (eligible && history.baseline.pool.state === "measured" && history.subject.pool.state === "measured") {
				const signal = history.baseline.pool.interval.upper < history.subject.pool.interval.lower || history.subject.pool.interval.upper < history.baseline.pool.interval.lower;
				assertProof(history.signal_observed === signal, `${step}/${history.metric} rate signal predicate differs from oracle`);
			}
		}
		for (const [distributionIndex, history] of actual.distribution_histories.entries()) {
			for (const [phaseName, indexes] of [["baseline", baselineIndexes], ["subject", subjectIndexes]] as const) {
				const expected = indexes.flatMap((index) => sourceRoles[index]!.distributions[distributionIndex]!.samples.map((sample) => ({
					source_scorecard_id: input.scorecards[index]!.artifact.id,
					source_scorecard_sha256: input.scorecards[index]!.descriptor.scorecard_sha256,
					...sample,
				})));
				const phase = history[phaseName];
				assertProof(isDeepStrictEqual(phase.samples, expected), `${step}/${history.metric}/${phaseName} raw samples lost source attribution`);
				assertProof(isDeepStrictEqual(phase.summary, oracleSummary(expected.map(({ value }) => value))), `${step}/${history.metric}/${phaseName} summary differs from raw-sample oracle`);
			}
			if (history.eligibility.state === "eligible" && history.baseline.summary.state === "measured" && history.subject.summary.state === "measured") {
				const signal = history.baseline.summary.max < history.subject.summary.min || history.subject.summary.max < history.baseline.summary.min;
				assertProof(history.signal_observed === signal, `${step}/${history.metric} range signal predicate differs from oracle`);
			}
		}
		for (const [countIndex, history] of actual.count_histories.entries()) {
			const baseline = baselineIndexes.reduce((sum, index) => sum + Object.values(sourceRoles[index]!.sample_counts)[countIndex]!, 0);
			const subject = subjectIndexes.reduce((sum, index) => sum + Object.values(sourceRoles[index]!.sample_counts)[countIndex]!, 0);
			assertProof(history.baseline_total === baseline && history.subject_total === subject, `${step}/${history.metric} count history differs from source scorecards`);
		}
		assertProof(actual.qualitative_histories.every((history) => history.baseline.length === baselineIndexes.length && history.subject.length === subjectIndexes.length), `${step} qualitative history lost a source pack`);
	}
}

async function mutateControlledScorecardInput(declarationPath: string, mutation: ControlledMutation): Promise<void> {
	const declaration = JSON.parse(await readFile(declarationPath, "utf8")) as JsonObject;
	const root = dirname(declarationPath);
	const resultsDirectory = resolve(root, String(declaration.benchmark_results_directory));
	const changedHashes = new Map<string, string>();
	const changedRuntimeHashes = new Map<string, string>();
	let changedConfigIdentity: string | undefined;
	const localModel = mutation === "local-a" ? "longitudinal/local-a" : mutation === "local-b" ? "longitudinal/local-b" : undefined;
	const localConfig = localModel === undefined ? undefined : {
		production_steps: Object.fromEntries(PRODUCTION_MODEL_STEPS.map((step) => [step, {
			adapter: "lmstudio", model: `${localModel}/${step}`, reasoning_effort: "provider_default",
		}])) as Record<ProductionModelStep, object>,
	};
	if (localConfig !== undefined) {
		changedConfigIdentity = evaluationConfigIdentity(localConfig);
		declaration.configuration_identity = changedConfigIdentity;
	}
	const untouchedTokenRole = new Set<string>();
	for (const descriptor of declaration.runs as JsonObject[]) {
		const runId = String(descriptor.benchmark_run_id);
		const runPath = join(resultsDirectory, `${runId}.json`);
		const run = JSON.parse(await readFile(runPath, "utf8")) as JsonObject;
		if (mutation === "retry") {
			const runDeclaration = run.declaration as JsonObject;
			runDeclaration.transport_retry_limit = 2;
			for (const trial of run.trials as JsonObject[]) {
				const invocations = trial.invocations as JsonObject[];
				for (const step of ["main_story_write", "announcements_write"] as const) {
					const failed = invocations.filter((invocation) => invocation.production_step === step && invocation.transport === "failed");
					const terminal = failed.at(-1);
					if (terminal === undefined) continue;
					terminal.retry_classification = {
						state: "classified",
						eligible: false,
						reason: "controlled longitudinal verifier terminal failure is not retry eligible",
					};
				}
			}
		} else if (mutation === "tokens" || mutation === "tokens-touch") {
			for (const trial of run.trials as JsonObject[]) for (const invocation of trial.invocations as JsonObject[]) {
				if (invocation.transport !== "succeeded") continue;
				const usage = ((invocation.completion as JsonObject).token_usage as JsonObject);
				if (usage.measurement !== "reported") continue;
				const role = String(invocation.production_step);
				if (mutation === "tokens-touch" && !untouchedTokenRole.has(role)) {
					untouchedTokenRole.add(role);
					continue;
				}
				usage.input_tokens = Number(usage.input_tokens) + 1_000_000;
				usage.output_tokens = Number(usage.output_tokens) + 1_000_000;
				usage.total_tokens = Number(usage.total_tokens) + 2_000_000;
			}
		} else if (localConfig !== undefined && changedConfigIdentity !== undefined) {
			((run.declaration as JsonObject).configurations as JsonObject[])[0] = { identity: changedConfigIdentity, config: localConfig };
			for (const roster of run.trial_roster as JsonObject[]) roster.config_identity = changedConfigIdentity;
			for (const trial of run.trials as JsonObject[]) {
				trial.config_identity = changedConfigIdentity;
				for (const invocation of trial.invocations as JsonObject[]) {
					invocation.config_identity = changedConfigIdentity;
					if (invocation.transport !== "succeeded") continue;
					const completion = invocation.completion as JsonObject;
					completion.model = `${localModel!}/${String(invocation.production_step)}`;
					completion.provider = "lmstudio";
					completion.execution = "local_inference";
					completion.token_usage = { measurement: "unavailable" };
					completion.external_billing = { classification: "none", amount_usd: 0, reason: "local_inference" };
				}
			}
			for (const runtime of run.runtime_evidence as JsonObject[]) {
				runtime.config_identity = changedConfigIdentity;
				if (runtime.state !== "captured") continue;
				const model = `${localModel!}/${String(runtime.production_step)}`;
				const evidence = runtime.evidence as JsonObject;
				const execution = evidence.execution_context as JsonObject;
				const selected = execution.selected_model as JsonObject;
				const response = execution.response_model as JsonObject;
				selected.requested_identity = { state: "observed", value: model };
				response.requested_identity = { state: "observed", value: model };
				response.identifier = { state: "observed", value: model };
				changedRuntimeHashes.set(String(runtime.invocation_id), canonicalHash(evidence));
			}
		} else if (mutation === "no-copyedit-evidence") {
			for (const trial of run.trials as JsonObject[]) {
				const original = trial.invocations as JsonObject[];
				const writers = original.filter((invocation) => invocation.production_step === "main_story_write" || invocation.production_step === "announcements_write").slice(0, 2);
				for (const [index, invocation] of writers.entries()) {
					delete invocation.completion;
					invocation.ordinal = index + 1;
					invocation.predecessor_invocation_id = null;
					invocation.transport = "failed";
					invocation.failure = { code: "controlled_no_copyedit_evidence", message: "Controlled terminal transport failure" };
					invocation.retry_classification = { state: "classified", eligible: false, reason: "controlled terminal failure" };
					invocation.parse = { state: "pending" };
				}
				trial.invocations = writers;
				trial.lifecycle = "complete";
				trial.subject_outcome = "infrastructure_incomplete";
				trial.tracks = {
					main_story: { lifecycle: "rejected", subject_outcome: "infrastructure_incomplete", terminal_production_step: "main_story_write", product: null, findings: [] },
					announcements: { lifecycle: "rejected", subject_outcome: "infrastructure_incomplete", terminal_production_step: "announcements_write", product: null, findings: [] },
				};
				trial.selected_invocation_ids = { main_story_write: null, main_story_copyedit: null, announcements_write: null, announcements_copyedit: null };
				run.runtime_evidence = writers.map((invocation) => ({
					trial_id: trial.id, invocation_id: invocation.id, config_identity: invocation.config_identity,
					production_step: invocation.production_step, ordinal: invocation.ordinal,
					state: "unavailable", reason: "transport_failed",
				}));
			}
			run.outcome_counts = { completed: 0, parse_rejected: 0, contract_rejected: 0, infrastructure_incomplete: (run.trials as JsonObject[]).length };
		}
		const bytes = json(run);
		await writeFile(runPath, bytes, "utf8");
		const sha256 = hash(bytes);
		descriptor.benchmark_run_sha256 = sha256;
		changedHashes.set(runId, sha256);
	}
	for (const field of ["annotations", "qualitative_reviews"] as const) {
		const pointer = declaration[field] as JsonObject;
		const path = resolve(root, String(pointer.path));
		const bundle = JSON.parse(await readFile(path, "utf8")) as JsonObject;
		const entries = (field === "annotations" ? bundle.outputs : bundle.reviews) as JsonObject[];
		for (const entry of entries) {
			const output = entry.output as JsonObject;
			output.benchmark_run_sha256 = changedHashes.get(String(output.benchmark_run_id));
			if (changedConfigIdentity !== undefined) output.config_identity = changedConfigIdentity;
			const runtimeHash = changedRuntimeHashes.get(String(output.invocation_id));
			if (runtimeHash !== undefined) output.runtime_evidence_sha256 = runtimeHash;
		}
		if (mutation === "no-copyedit-evidence") {
			if (field === "annotations") bundle.outputs = [];
			else bundle.reviews = [];
		}
		if (mutation === "qualitative" && field === "qualitative_reviews") {
			for (const review of bundle.reviews as JsonObject[]) for (const criterion of review.criteria as JsonObject[]) {
				criterion.assessment = "does_not_meet";
				criterion.rationale = "Controlled human review variation for longitudinal descriptive-history proof.";
				criterion.uncertainty = "high";
			}
		}
		if (mutation === "sparse-ungrounded" && field === "annotations") {
			let retained = false;
			for (const annotation of bundle.outputs as JsonObject[]) {
				const output = annotation.output as JsonObject;
				if (output.production_step !== "main_story_write") continue;
				const claims = annotation.factual_claims as JsonObject[];
				if (!retained && claims.length > 0) {
					const claim = claims[0]!;
					claim.references = [];
					claim.grounding = "not_grounded";
					annotation.factual_claims = [claim];
					retained = true;
				} else annotation.factual_claims = [];
			}
		}
		if (mutation === "all-ungrounded" && field === "annotations") {
			for (const annotation of bundle.outputs as JsonObject[]) for (const claim of annotation.factual_claims as JsonObject[]) {
				claim.references = [];
				claim.grounding = "not_grounded";
			}
		}
		const bytes = json(bundle);
		await writeFile(path, bytes, "utf8");
		pointer.sha256 = hash(bytes);
	}
	await writeFile(declarationPath, json(declaration), "utf8");
}

async function buildControlledScorecard(root: string, manifestPath: string, id: string, after: number, mutation?: ControlledMutation | readonly ControlledMutation[]) {
	const controlled = await buildControlledEvaluationScorecardInput(root, manifestPath);
	const mutations: readonly ControlledMutation[] = mutation === undefined ? [] : typeof mutation === "string" ? [mutation] : mutation;
	for (const item of mutations) {
		await mutateControlledScorecardInput(controlled.declarationPath, item);
	}
	const input = await loadEvaluationScorecardInput(controlled.declarationPath);
	const createdAtMs = Math.max(Date.parse(controlled.createdAt), after + 1);
	const artifact = buildEvaluationScorecard(input, { id, createdAt: new Date(createdAtMs).toISOString() });
	const directory = join(root, "retained-scorecard");
	await mkdir(directory, { recursive: true });
	await createEvaluationScorecardArtifact(join(directory, `${id}.json`), artifact);
	return { artifact, bytes: await readFile(join(directory, `${id}.json`)), createdAtMs };
}

async function writeDeclaration(root: string, id: string, scorecards: readonly { artifact: EvaluationScorecardArtifact; bytes: Uint8Array; phase: "baseline" | "subject" }[]): Promise<string> {
	const directory = join(root, "scorecards");
	await mkdir(directory, { recursive: true });
	const declaration = {
		version: 1 as const,
		id,
		scorecards: [] as Array<{ ordinal: number; phase: "baseline" | "subject"; path: string; scorecard_id: string; scorecard_sha256: string }>,
	};
	for (const [index, source] of scorecards.entries()) {
		const path = join(directory, `${source.artifact.id}.json`);
		await writeFile(path, source.bytes, { flag: "wx" });
		declaration.scorecards.push({ ordinal: index + 1, phase: source.phase, path: relative(root, path), scorecard_id: source.artifact.id, scorecard_sha256: hash(source.bytes) });
	}
	const declarationPath = join(root, "declaration.json");
	await writeFile(declarationPath, json(declaration), { flag: "wx" });
	return declarationPath;
}

type ScorecardSource = { artifact: EvaluationScorecardArtifact; bytes: Uint8Array; phase: "baseline" | "subject" };

async function buildStoredSeries(root: string, id: string, sources: readonly ScorecardSource[]): Promise<{
	artifact: EvaluationLongitudinalScorecardArtifact;
	input: LoadedEvaluationLongitudinalInput;
	report: string;
}> {
	const declarationPath = await writeDeclaration(join(root, "input"), `${id}-declaration`, sources);
	const input = await loadEvaluationLongitudinalInput(declarationPath);
	const latest = Math.max(...sources.map(({ artifact }) => Date.parse(artifact.created_at)));
	const built = buildEvaluationLongitudinalScorecard(input, { id, createdAt: new Date(latest + 1).toISOString() });
	const results = join(root, "results");
	await mkdir(results, { recursive: true });
	await createEvaluationLongitudinalScorecardArtifact(join(results, `${id}.json`), built);
	const artifact = await loadEvaluationLongitudinalScorecardArtifact(id, results);
	assertProof(isDeepStrictEqual(artifact, built), `${id} changed across the public store round trip`);
	return { artifact, input, report: formatEvaluationLongitudinalScorecardReport(artifact) };
}

function retainedSource(input: LoadedEvaluationLongitudinalInput, index: number, phase: "baseline" | "subject"): ScorecardSource {
	const source = input.scorecards[index]!;
	return { artifact: source.artifact, bytes: source.bytes, phase };
}

export async function generateControlledLongitudinalAuditPack(destination: string, manifestPath: string): Promise<EvaluationLongitudinalScorecardArtifact> {
	const root = await mkdtemp(join(tmpdir(), "bc-news-controlled-longitudinal-pack-"));
	try {
		const sources = []; let after = 0;
		for (let index = 0; index < 5; index += 1) {
			const source = await buildControlledScorecard(join(root, `source-${String(index + 1)}`), manifestPath, `controlled-longitudinal-scorecard-${String(index + 1)}`, after);
			after = source.createdAtMs; sources.push({ ...source, phase: index < 3 ? "baseline" as const : "subject" as const });
		}
		const declarationPath = await writeDeclaration(join(root, "series"), "controlled-longitudinal-declaration", sources);
		const input = await loadEvaluationLongitudinalInput(declarationPath);
		const artifact = buildEvaluationLongitudinalScorecard(input, { id: "controlled-longitudinal-series", createdAt: new Date(after + 1).toISOString() });
		await mkdir(dirname(destination), { recursive: true });
		await createEvaluationLongitudinalScorecardArtifact(destination, artifact);
		return artifact;
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

async function materializeArtifact(artifact: EvaluationLongitudinalScorecardArtifact, root: string): Promise<string> {
	const declarationBytes = Buffer.from(artifact.source_payloads.declaration_base64, "base64");
	const declaration = JSON.parse(declarationBytes.toString("utf8")) as { scorecards: Array<{ path: string }> };
	for (const [index, embedded] of artifact.source_payloads.scorecards.entries()) {
		const destination = join(root, declaration.scorecards[index]!.path);
		await mkdir(dirname(destination), { recursive: true });
		await writeFile(destination, Buffer.from(embedded.bytes_base64, "base64"), { flag: "wx" });
	}
	const declarationPath = join(root, "declaration.json");
	await writeFile(declarationPath, declarationBytes, { flag: "wx" });
	return declarationPath;
}

async function invokeCli(argv: readonly string[], root: string, appDirectory: string): Promise<string> {
	let output = "";
	await runEvalCliApplication({ argv, currentDirectory: root, appDirectory, environment: { INIT_CWD: root }, writeOutput: (text) => { output += text; } });
	return output;
}

async function proveStoredCorruptionMatrix(artifact: EvaluationLongitudinalScorecardArtifact, root: string): Promise<void> {
	await mkdir(root, { recursive: true });
	await expectCode(() => loadEvaluationLongitudinalScorecardArtifact("bad/id", root), "invalid_series_id");
	await expectCode(() => loadEvaluationLongitudinalScorecardArtifact("missing-series", root), "series_not_found");
	const malformed = join(root, "malformed"); await mkdir(malformed); await writeFile(join(malformed, "malformed.json"), "{not-json\n");
	await expectCode(() => loadEvaluationLongitudinalScorecardArtifact("malformed", malformed), "series_malformed");
	const invalid = join(root, "invalid"); await mkdir(invalid); await writeFile(join(invalid, "invalid.json"), json({ ...artifact, overall: 1 }));
	await expectCode(() => loadEvaluationLongitudinalScorecardArtifact("invalid", invalid), "series_invalid");
	for (const [index, mutate] of [
		(candidate: JsonObject) => { candidate.declaration_sha256 = "0".repeat(64); },
		(candidate: JsonObject) => { ((candidate.roles as JsonObject[])[0]!.classification as JsonObject).state = "potential_drift"; },
		(candidate: JsonObject) => { (((candidate.source_payloads as JsonObject).scorecards as JsonObject[])[0]!).bytes_base64 = Buffer.from("{}").toString("base64"); },
		(candidate: JsonObject) => { (((candidate.source_payloads as JsonObject).scorecards as JsonObject[])[0]!).ordinal = 99; },
		(candidate: JsonObject) => { ((candidate.scorecard_hashes as JsonObject[])[0]!).scorecard_sha256 = "1".repeat(64); },
		(candidate: JsonObject) => { ((((candidate.roles as JsonObject[])[0]!.sources as JsonObject[])[0]!)).scorecard_id = "fabricated-source-reference"; },
		(candidate: JsonObject) => { (candidate.source_payloads as JsonObject).declaration_base64 = `${String((candidate.source_payloads as JsonObject).declaration_base64)}\n`; },
	] .entries()) {
		const candidate = structuredClone(artifact) as unknown as JsonObject;
		mutate(candidate);
		const directory = join(root, `tampered-${String(index)}`); await mkdir(directory);
		await writeFile(join(directory, `${artifact.id}.json`), json(candidate));
		await expectCode(() => loadEvaluationLongitudinalScorecardArtifact(artifact.id, directory), "series_artifact_tampered");
	}
	const mismatch = join(root, "mismatch"); await mkdir(mismatch); await writeFile(join(mismatch, "different-id.json"), json(artifact));
	await expectCode(() => loadEvaluationLongitudinalScorecardArtifact("different-id", mismatch), "series_filename_mismatch");
	await expectCode(() => createEvaluationLongitudinalScorecardArtifact(join(root, "wrong-name.json"), artifact), "series_create_rejected");
	const createDirectory = join(root, "exclusive"); await mkdir(createDirectory);
	await createEvaluationLongitudinalScorecardArtifact(join(createDirectory, `${artifact.id}.json`), artifact);
	await expectCode(() => createEvaluationLongitudinalScorecardArtifact(join(createDirectory, `${artifact.id}.json`), artifact), "series_create_rejected");
}

async function proveLoadedBoundaryAndChronology(input: LoadedEvaluationLongitudinalInput, artifact: EvaluationLongitudinalScorecardArtifact, root: string): Promise<void> {
	const options = { id: "loaded-boundary-proof", createdAt: artifact.created_at };
	await expectCode(() => buildEvaluationLongitudinalScorecard({ ...input, scorecards: input.scorecards.slice(1) }, options), "longitudinal_evidence_set_mismatch");
	await expectCode(() => buildEvaluationLongitudinalScorecard({ ...input, scorecards: [input.scorecards[1]!, input.scorecards[0]!, ...input.scorecards.slice(2)] }, options), "longitudinal_evidence_set_mismatch");
	await expectCode(() => buildEvaluationLongitudinalScorecard({ ...input, scorecards: [input.scorecards[1]!, ...input.scorecards.slice(1)] }, options), "longitudinal_evidence_set_mismatch");
	const first = input.scorecards[0]!;
	await expectCode(() => buildEvaluationLongitudinalScorecard({ ...input, scorecards: [{ ...first, bytes: Buffer.from(first.bytes) }, ...input.scorecards.slice(1)] }, options), "longitudinal_evidence_set_mismatch");
	await expectCode(() => buildEvaluationLongitudinalScorecard({ ...input, scorecards: [{ ...first, artifact: structuredClone(first.artifact) }, ...input.scorecards.slice(1)] }, options), "longitudinal_evidence_set_mismatch");
	await expectCode(() => buildEvaluationLongitudinalScorecard({ ...input, scorecards: [{ ...first, annotationProvenance: { ...first.annotationProvenance, annotatorId: "forged-annotator" } }, ...input.scorecards.slice(1)] }, options), "longitudinal_evidence_set_mismatch");
	const roleDetached = structuredClone(first.artifact);
	roleDetached.scorecards.reverse();
	await expectCode(() => buildEvaluationLongitudinalScorecard({ ...input, scorecards: [{ ...first, artifact: roleDetached }, ...input.scorecards.slice(1)] }, options), "longitudinal_evidence_set_mismatch");
	const metricDetached = structuredClone(first.artifact);
	metricDetached.scorecards[0]!.rates.reverse();
	await expectCode(() => buildEvaluationLongitudinalScorecard({ ...input, scorecards: [{ ...first, artifact: metricDetached }, ...input.scorecards.slice(1)] }, options), "longitudinal_evidence_set_mismatch");

	const chronologyPath = await writeDeclaration(join(root, "chronology"), "chronology-series", [
		retainedSource(input, 1, "baseline"), retainedSource(input, 0, "subject"),
	]);
	await expectCode(() => loadEvaluationLongitudinalInput(chronologyPath), "longitudinal_chronology_mismatch");
}

async function proveRecycledUnderlyingEvidence(root: string, manifestPath: string, after: number): Promise<void> {
	const controlled = await buildControlledEvaluationScorecardInput(join(root, "shared-source"), manifestPath);
	const input = await loadEvaluationScorecardInput(controlled.declarationPath);
	const firstTime = Math.max(Date.parse(controlled.createdAt), after + 1);
	const first = buildEvaluationScorecard(input, { id: "recycled-source-a", createdAt: new Date(firstTime).toISOString() });
	const second = buildEvaluationScorecard(input, { id: "recycled-source-b", createdAt: new Date(firstTime + 1).toISOString() });
	const directory = join(root, "retained"); await mkdir(directory, { recursive: true });
	await createEvaluationScorecardArtifact(join(directory, `${first.id}.json`), first);
	await createEvaluationScorecardArtifact(join(directory, `${second.id}.json`), second);
	const declarationPath = await writeDeclaration(join(root, "series"), "recycled-evidence-series", [
		{ artifact: first, bytes: await readFile(join(directory, `${first.id}.json`)), phase: "baseline" },
		{ artifact: second, bytes: await readFile(join(directory, `${second.id}.json`)), phase: "subject" },
	]);
	await expectCode(() => loadEvaluationLongitudinalInput(declarationPath), "longitudinal_evidence_set_mismatch");
}

async function proveDeclarationAndSourceMatrix(artifact: EvaluationLongitudinalScorecardArtifact, root: string): Promise<void> {
	async function caseRoot(name: string): Promise<{ directory: string; declarationPath: string; declaration: JsonObject }> {
		const directory = join(root, name);
		const declarationPath = await materializeArtifact(artifact, directory);
		return { directory, declarationPath, declaration: JSON.parse(await readFile(declarationPath, "utf8")) as JsonObject };
	}
	{
		const { declarationPath } = await caseRoot("malformed-declaration");
		await writeFile(declarationPath, "{not-json\n");
		await expectCode(() => loadEvaluationLongitudinalInput(declarationPath), "invalid_longitudinal_declaration_json");
	}
	const rejectedMutations: Array<[string, (declaration: JsonObject) => void]> = [
		["unknown-field", (declaration) => { declaration.overall = 1; }],
		["noncontiguous-ordinal", (declaration) => { ((declaration.scorecards as JsonObject[])[1]!).ordinal = 9; }],
		["phase-reordered", (declaration) => { ((declaration.scorecards as JsonObject[])[1]!).phase = "subject"; }],
		["missing-subject", (declaration) => { for (const descriptor of declaration.scorecards as JsonObject[]) descriptor.phase = "baseline"; }],
		["duplicate-id", (declaration) => { ((declaration.scorecards as JsonObject[])[1]!).scorecard_id = ((declaration.scorecards as JsonObject[])[0]!).scorecard_id; }],
		["duplicate-path", (declaration) => { ((declaration.scorecards as JsonObject[])[1]!).path = ((declaration.scorecards as JsonObject[])[0]!).path; }],
		["duplicate-hash", (declaration) => { ((declaration.scorecards as JsonObject[])[1]!).scorecard_sha256 = ((declaration.scorecards as JsonObject[])[0]!).scorecard_sha256; }],
		["absolute-path", (declaration) => { ((declaration.scorecards as JsonObject[])[0]!).path = "/tmp/controlled-scorecard.json"; }],
		["dot-segment", (declaration) => { ((declaration.scorecards as JsonObject[])[0]!).path = "scorecards/../controlled-scorecard.json"; }],
		["escaping-path", (declaration) => { ((declaration.scorecards as JsonObject[])[0]!).path = "../controlled-scorecard.json"; }],
	];
	for (const [name, mutate] of rejectedMutations) {
		const { declarationPath, declaration } = await caseRoot(name);
		mutate(declaration);
		await writeFile(declarationPath, json(declaration));
		await expectCode(() => loadEvaluationLongitudinalInput(declarationPath), "longitudinal_declaration_rejected");
	}
	{
		const { declarationPath, declaration } = await caseRoot("missing-source");
		const descriptor = (declaration.scorecards as JsonObject[])[0]!;
		descriptor.scorecard_id = "missing-scorecard";
		descriptor.path = "scorecards/missing-scorecard.json";
		await writeFile(declarationPath, json(declaration));
		await expectCode(() => loadEvaluationLongitudinalInput(declarationPath), "scorecard_source_unreadable");
	}
	{
		const { declarationPath, declaration } = await caseRoot("hash-mismatch");
		((declaration.scorecards as JsonObject[])[0]!).scorecard_sha256 = "0".repeat(64);
		await writeFile(declarationPath, json(declaration));
		await expectCode(() => loadEvaluationLongitudinalInput(declarationPath), "scorecard_source_hash_mismatch");
	}
	for (const [name, bytes, expected] of [
		["malformed-source", "{not-json\n", "scorecard_source_malformed"],
		["invalid-source", json({ version: 1 }), "scorecard_source_invalid"],
	] as const) {
		const { directory, declarationPath, declaration } = await caseRoot(name);
		const descriptor = (declaration.scorecards as JsonObject[])[0]!;
		await writeFile(join(directory, String(descriptor.path)), bytes);
		descriptor.scorecard_sha256 = hash(bytes);
		await writeFile(declarationPath, json(declaration));
		await expectCode(() => loadEvaluationLongitudinalInput(declarationPath), expected);
	}
	{
		const { declarationPath, declaration } = await caseRoot("filename-mismatch");
		((declaration.scorecards as JsonObject[])[0]!).path = "scorecards/not-the-declared-id.json";
		await writeFile(declarationPath, json(declaration));
		await expectCode(() => loadEvaluationLongitudinalInput(declarationPath), "scorecard_source_filename_mismatch");
	}
	{
		const { directory, declarationPath, declaration } = await caseRoot("canonical-escape");
		const descriptor = (declaration.scorecards as JsonObject[])[0]!;
		const insidePath = join(directory, String(descriptor.path));
		const outsidePath = join(root, `${String(descriptor.scorecard_id)}-outside.json`);
		await writeFile(outsidePath, await readFile(insidePath));
		await rm(insidePath);
		await symlink(outsidePath, insidePath);
		await expectCode(() => loadEvaluationLongitudinalInput(declarationPath), "longitudinal_declaration_rejected");
	}
	{
		const { directory, declarationPath, declaration } = await caseRoot("canonical-alias");
		const descriptors = declaration.scorecards as JsonObject[];
		const firstPath = join(directory, String(descriptors[0]!.path));
		const secondPath = join(directory, String(descriptors[1]!.path));
		await rm(secondPath);
		await symlink(firstPath, secondPath);
		await expectCode(() => loadEvaluationLongitudinalInput(declarationPath), "longitudinal_declaration_rejected");
	}
}

function proveNoDecisionFields(artifact: EvaluationLongitudinalScorecardArtifact): void {
	const forbidden = new Set([
		"aggregate_score", "weighted_score", "rank", "winner", "recommendation", "quality_threshold",
		"pass", "fail", "verdict", "retry_trigger", "retry_action", "publication_decision",
		"acceptance_verdict", "production_selection",
	]);
	function walk(value: unknown, path: string): void {
		if (Array.isArray(value)) {
			for (const [index, child] of value.entries()) walk(child, `${path}[${String(index)}]`);
			return;
		}
		if (value === null || typeof value !== "object") return;
		for (const [key, child] of Object.entries(value)) {
			assertProof(!forbidden.has(key), `Forbidden decision field ${path}.${key} appeared in the longitudinal artifact`);
			walk(child, `${path}.${key}`);
		}
	}
	walk(artifact, "artifact");
}

function sortedWitnesses(witnesses: readonly { compared_ordinal: number; path: string }[]): boolean {
	return witnesses.every((witness, index) => index === 0
		|| witnesses[index - 1]!.compared_ordinal < witness.compared_ordinal
		|| (witnesses[index - 1]!.compared_ordinal === witness.compared_ordinal && witnesses[index - 1]!.path.localeCompare(witness.path) <= 0));
}

async function proveProductionControlledMatrix(
	root: string,
	manifestPath: string,
	committedInput: LoadedEvaluationLongitudinalInput,
	committedArtifact: EvaluationLongitudinalScorecardArtifact,
): Promise<void> {
	let after = Date.parse(committedArtifact.created_at);
	const build = async (name: string, mutation?: ControlledMutation | readonly ControlledMutation[]) => {
		const source = await buildControlledScorecard(join(root, name), manifestPath, `${name}-scorecard`, after, mutation);
		after = source.createdAtMs;
		return source;
	};

	const touchingOne = await build("touching-one", "tokens-touch");
	const touchingTwo = await build("touching-two", "tokens-touch");
	const touching = await buildStoredSeries(join(root, "touching-series"), "touching-series", [
		...committedInput.scorecards.slice(0, 3).map((_, index) => retainedSource(committedInput, index, "baseline")),
		{ ...touchingOne, phase: "subject" }, { ...touchingTwo, phase: "subject" },
	]);
	for (const role of touching.artifact.roles) {
		const history = role.distribution_histories.find(({ metric }) => metric === "input_tokens")!;
		assertProof(history.baseline.summary.state === "measured" && history.subject.summary.state === "measured" && history.baseline.summary.max === history.subject.summary.min, `${role.production_step} controlled token ranges did not touch exactly`);
		assertProof(!history.signal_observed, `${role.production_step} production range comparator treated touching as disjoint`);
	}

	const driftOne = await build("strict-drift-one", "tokens");
	const driftTwo = await build("strict-drift-two", "tokens");
	const drift = await buildStoredSeries(join(root, "strict-drift-series"), "strict-drift-series", [
		...committedInput.scorecards.slice(0, 3).map((_, index) => retainedSource(committedInput, index, "baseline")),
		{ ...driftOne, phase: "subject" }, { ...driftTwo, phase: "subject" },
	]);
	for (const role of drift.artifact.roles) {
		const history = role.distribution_histories.find(({ metric }) => metric === "input_tokens")!;
		assertProof(history.baseline.summary.state === "measured" && history.subject.summary.state === "measured" && history.baseline.summary.max < history.subject.summary.min && history.signal_observed, `${role.production_step} strict production range disjointness did not signal`);
		assertProof(role.classification.state === "potential_drift", `${role.production_step} strict token separation did not classify as potential drift`);
	}

	const qualitativeOne = await build("qualitative-one", "qualitative");
	const qualitativeTwo = await build("qualitative-two", "qualitative");
	const qualitative = await buildStoredSeries(join(root, "qualitative-series"), "qualitative-series", [
		...committedInput.scorecards.slice(0, 3).map((_, index) => retainedSource(committedInput, index, "baseline")),
		{ ...qualitativeOne, phase: "subject" }, { ...qualitativeTwo, phase: "subject" },
	]);
	for (const role of qualitative.artifact.roles) {
		assertProof(role.qualitative_histories.every(({ subject }) => subject.every(({ counts }) => counts.does_not_meet === counts.meets + counts.does_not_meet + counts.partly_meets + counts.uncertain)), `${role.production_step} controlled qualitative change was not retained`);
		assertProof(role.classification.state !== "context_changed" && role.classification.state !== "insufficient_evidence", `${role.production_step} qualitative-only source changes altered context or sufficiency`);
		if (role.classification.state === "potential_drift") assertProof(role.classification.signal_witnesses.every(({ kind }) => kind === "rate" || kind === "distribution"), `${role.production_step} qualitative history drove automatic drift`);
	}

	const sparse = await build("unequal-denominator", "sparse-ungrounded");
	const ordinary = await build("unequal-denominator-control");
	const unequal = await buildStoredSeries(join(root, "unequal-denominator-series"), "unequal-denominator-series", [
		...committedInput.scorecards.slice(0, 3).map((_, index) => retainedSource(committedInput, index, "baseline")),
		{ ...sparse, phase: "subject" }, { ...ordinary, phase: "subject" },
	]);
	const grounding = unequal.artifact.roles[0].rate_histories.find(({ metric }) => metric === "claim_grounding")!;
	const measurements = grounding.subject.observations.map(({ measurement }) => measurement);
	assertProof(measurements.every(({ state }) => state === "measured") && measurements[0]!.denominator !== measurements[1]!.denominator, "Controlled claim packs did not produce unequal denominators");
	const expectedNumerator = measurements.reduce((sum, measurement) => sum + measurement.numerator, 0);
	const expectedDenominator = measurements.reduce((sum, measurement) => sum + measurement.denominator, 0);
	const unweightedAverage = measurements.reduce((sum, measurement) => sum + (measurement.state === "measured" ? measurement.value : 0), 0) / measurements.length;
	assertProof(grounding.subject.pool.state === "measured" && grounding.subject.pool.numerator === expectedNumerator && grounding.subject.pool.denominator === expectedDenominator && grounding.subject.pool.value === expectedNumerator / expectedDenominator, "Production rate did not pool unequal source counts");
	assertProof(grounding.subject.pool.value !== unweightedAverage, "Production unequal-denominator proof could not distinguish pooling from averaged percentages");
	assertProof(isDeepStrictEqual(grounding.subject.pool.interval, oracleWilson(expectedNumerator, expectedDenominator)), "Production unequal-denominator Wilson interval differs from independent oracle");
	assertProof(grounding.baseline.pool.state === "measured" && grounding.subject.pool.state === "measured" && !grounding.signal_observed, "Production overlapping Wilson intervals incorrectly signaled");

	const ungroundedOne = await build("ungrounded-one", "all-ungrounded");
	const ungroundedTwo = await build("ungrounded-two", "all-ungrounded");
	const disjointRates = await buildStoredSeries(join(root, "disjoint-rate-series"), "disjoint-rate-series", [
		...committedInput.scorecards.slice(0, 3).map((_, index) => retainedSource(committedInput, index, "baseline")),
		{ ...ungroundedOne, phase: "subject" }, { ...ungroundedTwo, phase: "subject" },
	]);
	for (const role of disjointRates.artifact.roles.filter(({ production_step }) => production_step.startsWith("main_story"))) {
		const rate = role.rate_histories.find(({ metric }) => metric === "claim_grounding")!;
		assertProof(rate.baseline.pool.state === "measured" && rate.subject.pool.state === "measured" && rate.baseline.pool.interval.lower > rate.subject.pool.interval.upper && rate.signal_observed, `${role.production_step} strict production Wilson disjointness did not signal`);
	}

	const noEvidenceOne = await build("no-evidence-one", "no-copyedit-evidence");
	const noEvidenceTwo = await build("no-evidence-two", "no-copyedit-evidence");
	const noEvidence = await buildStoredSeries(join(root, "no-evidence-series"), "no-evidence-series", [
		...committedInput.scorecards.slice(0, 3).map((_, index) => retainedSource(committedInput, index, "baseline")),
		{ ...noEvidenceOne, phase: "subject" }, { ...noEvidenceTwo, phase: "subject" },
	]);
	for (const role of noEvidence.artifact.roles.filter(({ production_step }) => production_step.endsWith("copyedit"))) {
		assertProof(role.eligible_signal_witnesses.length === 0, `${role.production_step} fabricated eligible quantitative evidence`);
		assertProof(role.classification.state === "insufficient_evidence" && role.classification.reasons.includes("no_eligible_quantitative_measurement"), `${role.production_step} zero eligible measurements did not classify insufficient`);
	}

	const localA = await build("local-context-a", "local-a");
	const localB = await build("local-context-b", "local-b");
	const threeIdentity = await buildStoredSeries(join(root, "three-context-series"), "three-context-series", [
		retainedSource(committedInput, 0, "baseline"),
		{ ...localA, phase: "subject" }, { ...localB, phase: "subject" },
	]);
	for (const role of threeIdentity.artifact.roles) {
		assertProof(role.classification.state === "context_changed" && role.classification.context_identities.length === 3, `${role.production_step} did not retain three production context identities`);
		assertProof(role.context_differences.every(({ reference_scorecard_id }) => reference_scorecard_id === committedInput.scorecards[0]!.artifact.id), `${role.production_step} context witnesses did not use the first declared reference`);
		assertProof(sortedWitnesses(role.context_differences), `${role.production_step} context witnesses are not deterministic by ordinal and path`);
		assertProof(role.context_differences.some(({ reference_value, compared_value }) => reference_value.state === "missing" || compared_value.state === "missing"), `${role.production_step} three-context witnesses omitted present/missing adapter evidence`);
	}

	const changedSignalOne = await build("changed-signal-one", ["retry", "tokens"]);
	const changedSignalTwo = await build("changed-signal-two", ["retry", "tokens"]);
	const changedSignal = await buildStoredSeries(join(root, "changed-signal-series"), "changed-signal-series", [
		...committedInput.scorecards.slice(0, 3).map((_, index) => retainedSource(committedInput, index, "baseline")),
		{ ...changedSignalOne, phase: "subject" }, { ...changedSignalTwo, phase: "subject" },
	]);
	for (const role of changedSignal.artifact.roles) {
		assertProof(role.classification.state === "context_changed", `${role.production_step} signal outranked changed context`);
		assertProof(role.eligible_signal_witnesses.some(({ kind, metric, observed }) => kind === "distribution" && metric === "input_tokens" && observed), `${role.production_step} changed-context precedence case lacked its independent quantitative signal`);
		assertProof(role.context_differences.some(({ path }) => path === "projection.declared_transport_retry_limit"), `${role.production_step} changed-context precedence case omitted retry policy`);
	}

	const mixedRetry = structuredClone(committedInput.scorecards[0]!.artifact);
	const retryRole = mixedRetry.scorecards.find(({ production_step }) => production_step === "main_story_write")!;
	assertProof(retryRole.scorecard_context.state === "identified", "Mixed-retry production proof requires identified role context");
	const grouped = retryRole.scorecard_context.projection.request_hashes;
	const repeated = grouped.findIndex((request, index) => index > 0 && grouped.slice(0, index).some((candidate) => candidate.run_id === request.run_id && candidate.trial_id === request.trial_id));
	assertProof(repeated > 0, "Controlled scorecard lacks a realized retry group");
	grouped[repeated]!.request_sha256 = "f".repeat(64);
	await expectCode(() => projectLongitudinalRoleContext(mixedRetry, "main_story_write"), "cohort_projection_invalid");

	assertProof(touching.report.includes("strict_observed_range_disjointness") && drift.report.includes("potential_drift") && threeIdentity.report.includes("context_changed"), "Production controlled reports omitted the verified evidence states");
}


export async function verifyEvaluationLongitudinalScorecards(temporaryRoot?: string, explicitAuditPackPath?: string): Promise<string> {
	const root = temporaryRoot ?? await mkdtemp(join(tmpdir(), "bc-news-evaluation-longitudinal-scorecards-"));
	const auditPackPath = explicitAuditPackPath ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/fixtures/evaluation-longitudinal-scorecards/controlled-longitudinal-series.json");
	try {
		const artifact = await loadEvaluationLongitudinalScorecardArtifact("controlled-longitudinal-series", dirname(auditPackPath));
		const declarationPath = await materializeArtifact(artifact, join(root, "reconstructed"));
		const input = await loadEvaluationLongitudinalInput(declarationPath);
		const rebuilt = buildEvaluationLongitudinalScorecard(input, { id: artifact.id, createdAt: artifact.created_at });
		assertProof(isDeepStrictEqual(rebuilt, artifact), "Committed longitudinal audit pack did not reconstruct exactly");
		proveIndependentOracle(input, artifact);
		const runIds = artifact.source_payloads.scorecards.flatMap(({ bytes_base64 }) => {
			const scorecard = JSON.parse(Buffer.from(bytes_base64, "base64").toString("utf8")) as EvaluationScorecardArtifact;
			return scorecard.benchmark_run_hashes.map(({ benchmark_run_id }) => benchmark_run_id);
		});
		assertProof(new Set(runIds).size === runIds.length, "Committed audit pack recycled an underlying Benchmark Run id");
		const runHashes = artifact.source_payloads.scorecards.flatMap(({ bytes_base64 }) => {
			const scorecard = JSON.parse(Buffer.from(bytes_base64, "base64").toString("utf8")) as EvaluationScorecardArtifact;
			return scorecard.benchmark_run_hashes.map(({ benchmark_run_sha256 }) => benchmark_run_sha256);
		});
		assertProof(new Set(runHashes).size === runHashes.length, "Committed audit pack recycled an underlying Benchmark Run byte hash");
		assertProof(new Set(artifact.scorecard_hashes.map(({ scorecard_id }) => scorecard_id)).size === 5 && new Set(artifact.scorecard_hashes.map(({ created_at }) => created_at)).size === 5, "Controlled source identities or timestamps did not differ");
		for (const role of artifact.roles) {
			assertProof(role.classification.state === "within_baseline", `${role.production_step} controlled comparable history was not within baseline`);
			assertProof(role.stable_contexts.every((context) => isDeepStrictEqual(context, role.stable_contexts[0])), `${role.production_step} generated locators or timestamps split its cohort`);
		}
		proveNoDecisionFields(artifact);
		const report = formatEvaluationLongitudinalScorecardReport(artifact);
		assertProof((report.match(/Longitudinal role:/gu) ?? []).length === 4, "Report omitted a canonical role history");
		for (const visible of ["scorecard_sha256", "annotator_id", "reviewer_id", "denominator_unit", "wilson_score", "application_latency_ms", "provider_total_time_ms", "review_assessment", "rationale", "uncertainty"]) assertProof(report.includes(visible), `Report omitted ${visible}`);

		const insufficientDeclaration = await writeDeclaration(join(root, "insufficient"), "insufficient-series", [
			{ artifact: input.scorecards[0]!.artifact, bytes: input.scorecards[0]!.bytes, phase: "baseline" },
			{ artifact: input.scorecards[3]!.artifact, bytes: input.scorecards[3]!.bytes, phase: "subject" },
		]);
		const insufficient = buildEvaluationLongitudinalScorecard(await loadEvaluationLongitudinalInput(insufficientDeclaration), { id: "insufficient-series", createdAt: artifact.created_at });
		assertProof(insufficient.roles.every(({ classification }) => classification.state === "insufficient_evidence"), "Small comparable partitions were not insufficient");

		const manifestPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/fixtures/evaluation-corpus/manifest.json");
		await proveLoadedBoundaryAndChronology(input, artifact, join(root, "loaded-boundary"));
		await proveRecycledUnderlyingEvidence(join(root, "recycled-evidence"), manifestPath, Date.parse(artifact.created_at));
		await proveProductionControlledMatrix(join(root, "production-matrix"), manifestPath, input, artifact);

		const explicitDirectory = join(root, "cli-series");
		const buildReport = await invokeCli(["longitudinal", "build", "--input", declarationPath, "--results-dir", explicitDirectory], root, join(root, "cli-app"));
		const [createdName] = (await readdir(explicitDirectory)).filter((name) => name.endsWith(".json"));
		assertProof(createdName !== undefined, "Longitudinal build CLI did not retain an artifact");
		const showReport = await invokeCli(["longitudinal", "show", createdName.slice(0, -5), "--results-dir", explicitDirectory], root, join(root, "cli-app"));
		assertProof(showReport === buildReport, "Longitudinal show CLI did not reproduce the build report");
		await invokeCli(["longitudinal", "build", "--input", declarationPath], root, join(root, "default-cli-app"));
		assertProof((await readdir(join(root, "default-cli-app", "longitudinal-scorecard-results"))).some((name) => name.endsWith(".json")), "Longitudinal CLI did not use its default results directory");
		assertProof(formatEvalCliFailure(["longitudinal", "show", "missing"], new Error("controlled failure")) === "longitudinal scorecard failed: controlled failure", "Longitudinal CLI failure prefix changed");

		await proveDeclarationAndSourceMatrix(artifact, join(root, "declaration-source-matrix"));
		await proveStoredCorruptionMatrix(artifact, join(root, "stored-matrix"));
		return `${report}\n\nVerification classification matrix: context_changed insufficient_evidence within_baseline potential_drift\nraw_signal_proof: input_tokens`;
	} finally {
		if (temporaryRoot === undefined) await rm(root, { recursive: true, force: true });
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	verifyEvaluationLongitudinalScorecards().then(() => console.log("EVALUATION LONGITUDINAL SCORECARDS VERIFIED")).catch((error: unknown) => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}
