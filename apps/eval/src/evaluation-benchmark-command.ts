import { mkdir } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { prepareEvidence } from "@bc-news/generation-core";
import { EvalConfigSchema, loadLiveBenchmarkConfig } from "./config";
import {
	EvaluationCodeProvenanceSchema,
	V7BenchmarkRunSchema,
	evaluationConfigIdentity,
	evaluationOutputContractProvenance,
	type BenchmarkRun,
	type V7BenchmarkRun,
} from "./evaluation-artifact";
import { EvaluationArtifactStore, type EvaluationArtifactObserver } from "./evaluation-artifact-store";
import { loadFixture } from "./evidence-fixture";
import { codeProvenance } from "./evaluation-provenance";
import { executeEvaluationTrial } from "./evaluation-trial-execution";
import { emptyOutcomeCounts, emptyTrack, providersFor, safeEvaluationId, sha256Json } from "./evaluation-trial-support";
import type { ModelProviderEnvironment } from "./model-adapters";

const WORKSPACE_ROOT = new URL("../../../", import.meta.url).pathname;

export interface EvaluateBenchmarkCommandOptions {
	readonly fixturePath: string;
	readonly configPath: string;
	readonly resultsDirectory: string;
	readonly environment?: ModelProviderEnvironment;
	readonly artifactObserver?: EvaluationArtifactObserver;
	readonly sourceProvenance?: BenchmarkRun["provenance"]["code"];
}

export interface EvaluateBenchmarkCommandResult { readonly path: string; readonly benchmark: V7BenchmarkRun; }

export async function evaluateBenchmarkCommand(options: EvaluateBenchmarkCommandOptions): Promise<EvaluateBenchmarkCommandResult> {
	const declared = await loadLiveBenchmarkConfig(options.configPath);
	const configurations = declared.configurations.map((config) => ({ identity: evaluationConfigIdentity(config), config }));
	const provenance = {
		code: options.sourceProvenance === undefined
			? await codeProvenance(WORKSPACE_ROOT, options.resultsDirectory)
			: EvaluationCodeProvenanceSchema.parse(options.sourceProvenance),
		output_contracts: evaluationOutputContractProvenance(),
	};
	const loadedFixture = await loadFixture(options.fixturePath);
	const preparedEvidence = prepareEvidence({
		activeRegionId: loadedFixture.fixture.active_region_id,
		publicationDate: loadedFixture.publicationDate,
		messages: loadedFixture.fixture.messages,
	});
	await mkdir(options.resultsDirectory, { recursive: true });
	const benchmarkId = safeEvaluationId("benchmark");
	const trialRoster = configurations.flatMap((configuration) =>
		Array.from({ length: declared.repetition_count }, (_, index) => ({
			trial_id: `${benchmarkId}-trial-${String(index + 1)}-${configuration.identity}`,
			config_identity: configuration.identity,
			repetition: index + 1,
		})),
	);
	const startedAt = new Date().toISOString();
	let benchmark = V7BenchmarkRunSchema.parse({
		version: 7,
		id: benchmarkId,
		lifecycle: "running",
		started_at: startedAt,
		completed_at: null,
		declaration: {
			configurations,
			repetition_count: declared.repetition_count,
			transport_retry_limit: declared.transport_retry_limit,
		},
		fixture: { path: relative(WORKSPACE_ROOT, options.fixturePath), fixture_sha256: loadedFixture.fixtureSha256 },
		prepared_evidence: {
			identity_sha256: sha256Json(preparedEvidence),
			active_region_id: preparedEvidence.active_region_id,
			publication_date: preparedEvidence.publication_date,
			original_count: preparedEvidence.raw_count,
			final_count: preparedEvidence.final_count,
			snapshot: preparedEvidence,
		},
		provenance,
		trial_roster: trialRoster,
		trials: [],
		runtime_evidence: [],
		outcome_counts: emptyOutcomeCounts(),
		harness_outcome: "pending",
	});
	if (benchmark.version !== 7) throw new Error("Serial benchmark creation did not produce artifact version 7");
	const path = join(options.resultsDirectory, `${basename(benchmark.id)}.json`);
	const store = await EvaluationArtifactStore.create(path, benchmark, options.artifactObserver);

	for (const roster of benchmark.trial_roster) {
		const configuration = benchmark.declaration.configurations.find(({ identity }) => identity === roster.config_identity);
		if (configuration === undefined) throw new Error(`Trial ${roster.trial_id} references an undeclared configuration`);
		const trialStartedAt = new Date().toISOString();
		benchmark = V7BenchmarkRunSchema.parse({
			...benchmark,
			trials: [...benchmark.trials, {
				id: roster.trial_id,
				config_identity: roster.config_identity,
				repetition: roster.repetition,
				lifecycle: "running",
				started_at: trialStartedAt,
				completed_at: null,
				subject_outcome: null,
				tracks: { main_story: emptyTrack(), announcements: emptyTrack() },
				selected_invocation_ids: { main_story_write: null, main_story_copyedit: null, announcements_write: null, announcements_copyedit: null },
				invocations: [],
			}],
		});
		await store.replace(benchmark);
		benchmark = await executeEvaluationTrial({
			benchmark,
			store,
			preparedEvidence,
			providers: providersFor(
				EvalConfigSchema.parse(configuration.config),
				options.environment ?? process.env,
			),
			configIdentity: roster.config_identity,
			trialId: roster.trial_id,
			transportRetryLimit: declared.transport_retry_limit,
		});
		if (benchmark.version !== 7) throw new Error("Serial benchmark execution changed artifact version");
	}

	const completedAt = new Date().toISOString();
	benchmark = V7BenchmarkRunSchema.parse({ ...benchmark, lifecycle: "complete", completed_at: completedAt, harness_outcome: "retained" });
	if (benchmark.version !== 7) throw new Error("Serial benchmark completion changed artifact version");
	await store.replace(benchmark);
	return { path, benchmark };
}
