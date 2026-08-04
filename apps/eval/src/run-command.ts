import { createHash } from "node:crypto";
import { relative } from "node:path";
import { prepareEvidence, type EditorialCapability, type PreparedEvidence } from "@bc-news/generation-core";
import { CAPABILITY_ROSTER, capabilityRunners } from "./capability-runners";
import { runEvalChecks, type CheckResult } from "./checks/index";
import { loadConfig, type EvalConfig } from "./config";
import { loadFixture } from "./evidence-fixture";
import { collectRunFingerprint, WORKSPACE_ROOT, type ProviderParamEntry, type ProviderParams } from "./fingerprint";
import { resolveModelProvider } from "./model-adapters";
import { generateRunId, saveRunFile, type RunFile } from "./run-file";

export interface RunCommandOptions {
	readonly fixturePath: string;
	readonly configPath: string;
	readonly resultsDirectory: string;
	readonly noJudge: boolean;
}

export class JudgeNotImplementedError extends Error {
	readonly code = "judge_not_implemented";

	constructor() {
		super(
			"Judge execution is not implemented in this slice; pass --no-judge or set judge: null in the config",
		);
		this.name = "JudgeNotImplementedError";
	}
}

interface CapabilityStepResult {
	readonly capability: EditorialCapability;
	readonly promptSha256: string;
	readonly output: Record<string, unknown>;
	readonly checks: readonly CheckResult[];
	readonly providerParam: ProviderParamEntry;
}

async function runCapability(
	capability: EditorialCapability,
	config: EvalConfig,
	preparedEvidence: PreparedEvidence,
): Promise<CapabilityStepResult> {
	const runner = capabilityRunners[capability];
	const prompt = runner.buildPrompt(preparedEvidence);
	const promptSha256 = createHash("sha256").update(prompt).digest("hex");
	const provider = resolveModelProvider(capability, config.capabilities[capability]);
	const completion = await provider.complete({ editorialCapability: capability, system: runner.system, user: prompt });
	const output = runner.parseOutput(completion.text);
	const checks = runEvalChecks({
		editorialCapability: capability,
		rawText: completion.text,
		output,
		preparedEvidence,
	});
	return {
		capability,
		promptSha256,
		output,
		checks,
		providerParam: { provider: completion.provider, model: completion.model },
	};
}

/**
 * ProviderParamsSchema keys are fixed (main_story, optional judge), matching
 * v1's discipline of a closed field set rather than an open record: an
 * unexpected roster entry is a defect to surface, not silently accept.
 */
function assembleProviderParams(results: readonly CapabilityStepResult[]): ProviderParams {
	const mainStory = results.find((result) => result.capability === "main_story");
	if (mainStory === undefined) {
		throw new Error("main_story capability produced no result; provider_params cannot be assembled");
	}
	return { main_story: mainStory.providerParam };
}

/**
 * All-or-nothing persistence, kept intact from v1: if any capability fails,
 * this rejects and runCommand never calls saveRunFile, so no partial run
 * file is written. A partially-failed run is not comparable retained
 * evidence of editorial quality -- it is an ops signal -- so relaxing this
 * would not serve the PRD's retained-evidence requirement; it would just
 * make "did this run succeed" ambiguous from the results directory alone.
 */
export async function runCommand(options: RunCommandOptions): Promise<{ path: string; run: RunFile }> {
	const config = await loadConfig(options.configPath);
	if (config.judge !== null && !options.noJudge) {
		throw new JudgeNotImplementedError();
	}

	const loadedFixture = await loadFixture(options.fixturePath);
	// Fingerprint content is collected here, before any provider call, per the
	// fingerprint discipline: identity describes what actually produced the
	// run, not whatever the checks/providers/schemas had drifted to by the
	// time the run finished.
	const fingerprintContent = await collectRunFingerprint(loadedFixture.bytes);

	const startedAt = new Date().toISOString();
	const preparedEvidence = prepareEvidence({
		activeRegionId: loadedFixture.fixture.active_region_id,
		publicationDate: loadedFixture.publicationDate,
		messages: loadedFixture.fixture.messages,
	});

	// Every roster entry has a required config.capabilities entry (schema-enforced),
	// so the full roster runs -- independently, per the run's execution topology.
	const results = await Promise.all(
		CAPABILITY_ROSTER.map((capability) => runCapability(capability, config, preparedEvidence)),
	);
	const completedAt = new Date().toISOString();

	const run: RunFile = {
		id: generateRunId(),
		config,
		// Workspace-relative, not the resolved absolute path: the run file is
		// committed evidence and must stay portable across machines and CI.
		fixture: { path: relative(WORKSPACE_ROOT, options.fixturePath), fixture_sha256: loadedFixture.fixtureSha256 },
		steps: results.map((result) => ({
			capability: result.capability,
			prompt_sha256: result.promptSha256,
			output: result.output,
			schema_valid: true,
			checks: [...result.checks],
			judge: null,
		})),
		started_at: startedAt,
		completed_at: completedAt,
		fingerprint: {
			...fingerprintContent,
			provider_params: assembleProviderParams(results),
		},
	};

	const path = await saveRunFile(run, options.resultsDirectory);
	return { path, run };
}
