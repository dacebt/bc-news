import { createHash } from "node:crypto";
import { relative } from "node:path";
import type {
	AnnouncementsOutput,
	EditorialCapability,
	MainStoryOutput,
	PreparedEvidence,
} from "@bc-news/generation-core";
import {
	CAPABILITY_ROSTER,
	independentCapabilityRunners,
	packagingCapabilityRunner,
} from "./capability-runners";
import {
	runEvalChecks,
	type CheckResult,
	type PackagingRetainedOutput,
	type RetainedCapabilityOutput,
} from "./checks/index";
import { loadConfig, type EvalConfig } from "./config";
import { loadFixture } from "./evidence-fixture";
import { collectRunFingerprint, WORKSPACE_ROOT, type ProviderParamEntry, type ProviderParams } from "./fingerprint";
import { runJudge, type JudgeStepResult } from "./judge";
import { resolveModelProvider } from "./model-adapters";
import { generateRunId, saveRunFile, type RunFile } from "./run-file";
import { prepareEvidence } from "@bc-news/generation-core";

export interface RunCommandOptions {
	readonly fixturePath: string;
	readonly configPath: string;
	readonly resultsDirectory: string;
	readonly noJudge: boolean;
}

interface CapabilityStepResult {
	readonly capability: EditorialCapability;
	readonly promptSha256: string;
	readonly output: RetainedCapabilityOutput;
	readonly checks: readonly CheckResult[];
	readonly judge: JudgeStepResult | null;
	readonly providerParam: ProviderParamEntry;
}

async function judgeOutput(
	capability: EditorialCapability,
	output: RetainedCapabilityOutput,
	config: EvalConfig,
	preparedEvidence: PreparedEvidence,
): Promise<JudgeStepResult> {
	if (config.judge === null) throw new Error("judgeOutput requires a configured judge adapter");
	return runJudge({
		capability,
		outputText: JSON.stringify(output),
		preparedEvidence,
		provider: resolveModelProvider(capability, config.judge, "judge"),
	});
}

async function runIndependentCapability(
	capability: "main_story" | "announcements",
	config: EvalConfig,
	preparedEvidence: PreparedEvidence,
): Promise<CapabilityStepResult> {
	const runner = independentCapabilityRunners[capability];
	const prompt = runner.buildPrompt(preparedEvidence);
	const promptSha256 = createHash("sha256").update(prompt).digest("hex");
	const completion = await resolveModelProvider(capability, config.capabilities[capability], "capability").complete({
		editorialCapability: capability,
		system: runner.system,
		user: prompt,
	});
	const output = runner.parseOutput(completion.text);
	return {
		capability,
		promptSha256,
		output,
		checks: runEvalChecks({ editorialCapability: capability, rawText: completion.text, output, preparedEvidence }),
		judge: null,
		providerParam: { provider: completion.provider, model: completion.model },
	};
}

async function runPackagingCapability(
	config: EvalConfig,
	preparedEvidence: PreparedEvidence,
	mainStoryOutput: MainStoryOutput,
	announcementsOutput: AnnouncementsOutput,
): Promise<CapabilityStepResult> {
	const capability = "packaging" as const;
	const prompt = packagingCapabilityRunner.buildPrompt(preparedEvidence, mainStoryOutput, announcementsOutput);
	const promptSha256 = createHash("sha256").update(prompt).digest("hex");
	const completion = await resolveModelProvider(capability, config.capabilities.packaging, "capability").complete({
		editorialCapability: capability,
		system: packagingCapabilityRunner.system,
		user: prompt,
	});
	const packaging = packagingCapabilityRunner.parseOutput(completion.text);
	const output: PackagingRetainedOutput = {
		active_region_id: preparedEvidence.active_region_id,
		publication_date: preparedEvidence.publication_date,
		title: packaging.title,
		subtitle: packaging.subtitle,
		announcements: announcementsOutput.announcements,
		main_story: mainStoryOutput.main_story,
	};
	return {
		capability,
		promptSha256,
		output,
		checks: runEvalChecks({
			editorialCapability: capability,
			rawText: completion.text,
			output,
			preparedEvidence,
			mainStoryOutput,
			announcementsOutput,
		}),
		judge: null,
		providerParam: { provider: completion.provider, model: completion.model },
	};
}

async function applyJudgments(
	generatedResults: readonly CapabilityStepResult[],
	config: EvalConfig,
	preparedEvidence: PreparedEvidence,
	noJudge: boolean,
): Promise<CapabilityStepResult[]> {
	if (config.judge === null || noJudge) return [...generatedResults];
	const judgedResults: CapabilityStepResult[] = [];
	for (const capability of CAPABILITY_ROSTER) {
		const generated = generatedResults.find((result) => result.capability === capability);
		if (generated === undefined) throw new Error(`${capability} produced no generated result`);
		judgedResults.push({
			...generated,
			judge: await judgeOutput(capability, generated.output, config, preparedEvidence),
		});
	}
	return judgedResults;
}

function assembleProviderParams(results: readonly CapabilityStepResult[]): ProviderParams {
	const entries = Object.fromEntries(results.map((result) => [result.capability, result.providerParam]));
	const judgeProviderParam = results.find((result) => result.judge !== null)?.judge?.providerParam;
	return {
		main_story: entries.main_story!,
		announcements: entries.announcements!,
		packaging: entries.packaging!,
		...(judgeProviderParam === undefined ? {} : { judge: judgeProviderParam }),
	};
}

export async function runCommand(options: RunCommandOptions): Promise<{ path: string; run: RunFile }> {
	const config = await loadConfig(options.configPath);
	const loadedFixture = await loadFixture(options.fixturePath);
	const usesJudge = config.judge !== null && !options.noJudge;
	const fingerprintContent = await collectRunFingerprint(loadedFixture.bytes, usesJudge);
	const startedAt = new Date().toISOString();
	const preparedEvidence = prepareEvidence({
		activeRegionId: loadedFixture.fixture.active_region_id,
		publicationDate: loadedFixture.publicationDate,
		messages: loadedFixture.fixture.messages,
	});

	const mainStory = await runIndependentCapability("main_story", config, preparedEvidence);
	const announcements = await runIndependentCapability("announcements", config, preparedEvidence);
	const packaging = await runPackagingCapability(
		config,
		preparedEvidence,
		mainStory.output as MainStoryOutput,
		announcements.output as AnnouncementsOutput,
	);
	const results = await applyJudgments(
		[mainStory, announcements, packaging],
		config,
		preparedEvidence,
		options.noJudge,
	);
	const completedAt = new Date().toISOString();
	const run: RunFile = {
		id: generateRunId(),
		config,
		fixture: { path: relative(WORKSPACE_ROOT, options.fixturePath), fixture_sha256: loadedFixture.fixtureSha256 },
		steps: CAPABILITY_ROSTER.map((capability) => {
			const result = results.find((entry) => entry.capability === capability)!;
			return {
				capability: result.capability,
				prompt_sha256: result.promptSha256,
				output: result.output as unknown as Record<string, unknown>,
				schema_valid: true,
				checks: [...result.checks],
				judge: result.judge === null ? null : {
					scores: result.judge.scores,
					reasoning: result.judge.reasoning,
					aggregate: result.judge.aggregate,
					weighting: result.judge.weighting,
					provenance: {
						source: result.judge.provenance.source,
						prompt_sha256: result.judge.provenance.promptSha256,
						response_sha256: result.judge.provenance.responseSha256,
					},
				},
			};
		}),
		started_at: startedAt,
		completed_at: completedAt,
		fingerprint: { ...fingerprintContent, provider_params: assembleProviderParams(results) },
	};
	const path = await saveRunFile(run, options.resultsDirectory);
	return { path, run };
}
