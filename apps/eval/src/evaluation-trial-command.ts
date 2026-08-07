import { mkdir } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { prepareEvidence } from "@bc-news/generation-core";
import { loadLiveEvaluationConfig } from "./config";
import { BenchmarkRunSchema, EvaluationCodeProvenanceSchema, evaluationConfigIdentity, evaluationOutputContractProvenance, type BenchmarkRun } from "./evaluation-artifact";
import { EvaluationArtifactStore, type EvaluationArtifactObserver } from "./evaluation-artifact-store";
import { loadFixture } from "./evidence-fixture";
import { codeProvenance } from "./evaluation-provenance";
import { executeEvaluationTrial } from "./evaluation-trial-execution";
import { emptyOutcomeCounts, emptyTrack, providersFor, safeEvaluationId, sha256Json } from "./evaluation-trial-support";
import type { ModelProviderEnvironment } from "./model-adapters";

const WORKSPACE_ROOT = new URL("../../../", import.meta.url).pathname;

export interface EvaluateTrialCommandOptions {
	readonly fixturePath: string;
	readonly configPath: string;
	readonly resultsDirectory: string;
	readonly environment?: ModelProviderEnvironment;
	readonly artifactObserver?: EvaluationArtifactObserver;
	readonly sourceProvenance?: BenchmarkRun["provenance"]["code"];
}

export interface EvaluateTrialCommandResult { readonly path: string; readonly benchmark: BenchmarkRun; }

export async function evaluateTrialCommand(options: EvaluateTrialCommandOptions): Promise<EvaluateTrialCommandResult> {
	const config = await loadLiveEvaluationConfig(options.configPath);
	const configIdentity = evaluationConfigIdentity(config);
	const provenance = {
		code: options.sourceProvenance === undefined
			? await codeProvenance(WORKSPACE_ROOT, options.resultsDirectory)
			: EvaluationCodeProvenanceSchema.parse(options.sourceProvenance),
		output_contracts: evaluationOutputContractProvenance(),
	};
	const loadedFixture = await loadFixture(options.fixturePath);
	const preparedEvidence = prepareEvidence({ activeRegionId: loadedFixture.fixture.active_region_id, publicationDate: loadedFixture.publicationDate, messages: loadedFixture.fixture.messages });
	const providers = providersFor(config, options.environment ?? process.env);
	await mkdir(options.resultsDirectory, { recursive: true });
	const benchmarkId = safeEvaluationId("benchmark");
	const trialId = `${benchmarkId}-trial-1`;
	const startedAt = new Date().toISOString();
	const transportRetryLimit = 1;
	const benchmark = BenchmarkRunSchema.parse({
		version: 3, id: benchmarkId, lifecycle: "running", started_at: startedAt, completed_at: null,
		declaration: { configurations: [{ identity: configIdentity, config }], repetition_count: 1, transport_retry_limit: transportRetryLimit },
		fixture: { path: relative(WORKSPACE_ROOT, options.fixturePath), fixture_sha256: loadedFixture.fixtureSha256 },
		prepared_evidence: { identity_sha256: sha256Json(preparedEvidence), active_region_id: preparedEvidence.active_region_id, publication_date: preparedEvidence.publication_date, original_count: preparedEvidence.raw_count, final_count: preparedEvidence.final_count, snapshot: preparedEvidence },
		provenance,
		trial_roster: [{ trial_id: trialId, config_identity: configIdentity, repetition: 1 }],
		trials: [{ id: trialId, config_identity: configIdentity, repetition: 1, lifecycle: "running", started_at: startedAt,
			completed_at: null, subject_outcome: null, tracks: { main_story: emptyTrack(), announcements: emptyTrack() },
			selected_invocation_ids: { main_story_write: null, main_story_copyedit: null, announcements_write: null, announcements_copyedit: null }, invocations: [] }],
		outcome_counts: emptyOutcomeCounts(), harness_outcome: "pending",
	});
	const path = join(options.resultsDirectory, `${basename(benchmark.id)}.json`);
	const store = await EvaluationArtifactStore.create(path, benchmark, options.artifactObserver);
	const executed = await executeEvaluationTrial({
		benchmark,
		store,
		preparedEvidence,
		providers,
		configIdentity,
		transportRetryLimit,
	});
	if (executed.version !== 3) throw new Error("Single-trial evaluation changed artifact version");
	const completed = BenchmarkRunSchema.parse({
		...executed,
		lifecycle: "complete",
		completed_at: new Date().toISOString(),
		harness_outcome: "retained",
	});
	if (completed.version !== 3) throw new Error("Single-trial evaluation completion changed artifact version");
	await store.replace(completed);
	return { path, benchmark: completed };
}
