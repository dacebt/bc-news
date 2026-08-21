import { createHash } from "node:crypto";
import { relative } from "node:path";
import { modelRequestSha256 } from "@bc-news/fixtures";
import {
	PreparedEvidenceSchema,
	WRITER_SYSTEM_CONSTRAINTS,
	buildAnnouncementsWriterPrompt,
	buildMainStoryWriterPrompt,
	prepareEvidence,
	type ModelCompletion,
	type ModelProviderPort,
	type PreparedEvidence,
} from "@bc-news/generation-core";
import {
	PRODUCTION_STEP_OUTPUT_CONTRACTS,
	buildLmStudioPredictionRequest,
	lmStudioInferenceConfig,
	type LmStudioAdapterConfig,
} from "@bc-news/model-adapters";
import {
	CONTEXT_BENCHMARK_LOADS,
	ContextBenchmarkFileV3Schema,
	generateContextBenchmarkId,
	saveContextBenchmarkFile,
	type ContextBenchmarkFileV3,
	type ContextBenchmarkRow,
} from "./context-benchmark-file";
import {
	createLmStudioContextBenchmarkRuntime,
	lmStudioSdkBaseUrl,
	type ContextBenchmarkModel,
	type ContextBenchmarkPrompt,
	type ContextBenchmarkRuntime,
} from "./context-benchmark-runtime";
import {
	CURRENT_PRODUCTION_MODEL_STEPS,
	type CurrentProductionModelStep,
} from "./current-production-steps";
import { ProductionStepsConfigSchema } from "./config";
import { loadFixture } from "./evidence-fixture";
import { resolveModelProvider, type ModelProviderEnvironment } from "./model-adapters";

const WORKSPACE_ROOT = new URL("../../../", import.meta.url).pathname;

export interface ContextBenchmarkEnvironment extends ModelProviderEnvironment {
	readonly MODEL_CONFIG?: string;
}

export interface ContextBenchmarkCommandOptions {
	readonly fixturePath: string;
	readonly resultsDirectory: string;
	readonly environment?: ContextBenchmarkEnvironment;
	readonly runtime?: ContextBenchmarkRuntime;
	readonly now?: () => Date;
}

export class ContextBenchmarkCommandError extends Error {
	readonly code:
		| "invalid_model_config"
		| "non_lmstudio_config"
		| "mixed_model_config"
		| "loaded_model_mismatch"
		| "prepared_ceiling_mismatch"
		| "token_usage_unavailable"
		| "model_response_mismatch"
		| "token_attribution_failed"
		| "context_exceeded";

	constructor(code: ContextBenchmarkCommandError["code"], message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "ContextBenchmarkCommandError";
		this.code = code;
	}
}

function parseLmStudioConfig(environment: ContextBenchmarkEnvironment): {
	readonly baseUrl: string;
	readonly steps: Readonly<Record<CurrentProductionModelStep, LmStudioAdapterConfig>>;
} {
	const raw = environment.MODEL_CONFIG;
	const baseUrl = environment.LMSTUDIO_BASE_URL;
	if (raw === undefined || raw === "" || baseUrl === undefined || baseUrl === "") {
		throw new ContextBenchmarkCommandError(
			"invalid_model_config",
			"MODEL_CONFIG and LMSTUDIO_BASE_URL are required for the context benchmark",
		);
	}
	let candidate: unknown;
	try {
		candidate = JSON.parse(raw);
	} catch (cause) {
		throw new ContextBenchmarkCommandError("invalid_model_config", "MODEL_CONFIG is not valid JSON", { cause });
	}
	const parsed = ProductionStepsConfigSchema.safeParse(candidate);
	if (!parsed.success) {
		throw new ContextBenchmarkCommandError("invalid_model_config", parsed.error.message);
	}
	const requireLocal = (
		step: CurrentProductionModelStep,
	): LmStudioAdapterConfig => {
		const config = parsed.data[step];
		if (config.adapter !== "lmstudio") {
			throw new ContextBenchmarkCommandError(
				"non_lmstudio_config",
				`${step} must use the lmstudio adapter for the local context benchmark`,
			);
		}
		return config;
	};
	const steps = {
		main_story_write: requireLocal("main_story_write"),
		announcements_write: requireLocal("announcements_write"),
	};
	const models = new Set(
		CURRENT_PRODUCTION_MODEL_STEPS.map((step) => steps[step].model),
	);
	if (models.size !== 1) {
		throw new ContextBenchmarkCommandError(
			"mixed_model_config",
			"Both production steps must name the same loaded Qwen model for this benchmark",
		);
	}
	return { baseUrl, steps };
}

function loadedModelNames(model: ContextBenchmarkModel): readonly string[] {
	return [model.identifier, model.modelKey, model.path, model.displayName];
}

function assertConfiguredModel(configuredModel: string, model: ContextBenchmarkModel): void {
	if (!loadedModelNames(model).includes(configuredModel)) {
		throw new ContextBenchmarkCommandError(
			"loaded_model_mismatch",
			`Configured model "${configuredModel}" does not exactly name the only loaded Qwen instance`,
		);
	}
}

function projectedEvidence(canonical: PreparedEvidence, messageLoad: number): PreparedEvidence {
	return PreparedEvidenceSchema.parse({
		...canonical,
		final_count: messageLoad,
		messages: canonical.messages.slice(0, messageLoad),
		drop_stats: {
			...canonical.drop_stats,
			sampling_dropped: canonical.after_burst_count - messageLoad,
		},
	});
}

function emptyEvidence(canonical: PreparedEvidence): PreparedEvidence {
	return PreparedEvidenceSchema.parse({
		active_region_id: canonical.active_region_id,
		publication_date: canonical.publication_date,
		raw_count: 0,
		after_filter_count: 0,
		after_burst_count: 0,
		final_count: 0,
		drop_stats: { empty_after_trim: 0, too_short: 0, burst_merged: 0, sampling_dropped: 0 },
		messages: [],
	});
}

function baselinePrompt(
	step: CurrentProductionModelStep,
	canonical: PreparedEvidence,
): ContextBenchmarkPrompt {
	switch (step) {
		case "main_story_write":
			return { system: WRITER_SYSTEM_CONSTRAINTS, user: buildMainStoryWriterPrompt(emptyEvidence(canonical)) };
		case "announcements_write":
			return { system: WRITER_SYSTEM_CONSTRAINTS, user: buildAnnouncementsWriterPrompt(emptyEvidence(canonical)) };
	}
}

function sha256Json(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function retainedAgentConfiguration(
	config: LmStudioAdapterConfig,
): ContextBenchmarkFileV3["agent_configurations"][CurrentProductionModelStep] {
	return structuredClone(config);
}

async function measureCompletion(input: {
	readonly messageLoad: number;
	readonly step: CurrentProductionModelStep;
	readonly prompt: ContextBenchmarkPrompt;
	readonly baseline: ContextBenchmarkPrompt;
	readonly config: LmStudioAdapterConfig;
	readonly provider: ModelProviderPort;
	readonly model: ContextBenchmarkModel;
}): Promise<{ readonly completion: ModelCompletion; readonly row: ContextBenchmarkRow }> {
	const [templated, fixedTemplated] = await Promise.all([
		input.model.applyPromptTemplate(input.prompt),
		input.model.applyPromptTemplate(input.baseline),
	]);
	const [templatedTokens, fixedInputTokens] = await Promise.all([
		input.model.countTokens(templated),
		input.model.countTokens(fixedTemplated),
	]);
	const evidenceOrDraftTokens = templatedTokens - fixedInputTokens;
	if (evidenceOrDraftTokens < 0) {
		throw new ContextBenchmarkCommandError(
			"token_attribution_failed",
			`${input.step} at load ${input.messageLoad} has a negative evidence/draft token marginal`,
		);
	}
	const completion = await input.provider.complete({
		productionStep: input.step,
		system: input.prompt.system,
		user: input.prompt.user,
	});
	if (completion.token_usage.measurement !== "reported") {
		throw new ContextBenchmarkCommandError(
			"token_usage_unavailable",
			`${input.step} at load ${input.messageLoad} did not report token usage`,
		);
	}
	if (!loadedModelNames(input.model).includes(completion.model)) {
		throw new ContextBenchmarkCommandError(
			"model_response_mismatch",
			`${input.step} completion model "${completion.model}" does not name the loaded Qwen instance`,
		);
	}
	const runtimeDeltaTokens = completion.token_usage.input_tokens - templatedTokens;
	if (runtimeDeltaTokens < 0) {
		throw new ContextBenchmarkCommandError(
			"token_attribution_failed",
			`${input.step} provider input usage is smaller than the model-template token count`,
		);
	}
	const contextHeadroomTokens = input.model.contextLength - completion.token_usage.total_tokens;
	if (contextHeadroomTokens < 0) {
		throw new ContextBenchmarkCommandError(
			"context_exceeded",
			`${input.step} at load ${input.messageLoad} exceeded the loaded context length`,
		);
	}
	const requestBody = buildLmStudioPredictionRequest({
		productionStep: input.step,
		system: input.prompt.system,
		user: input.prompt.user,
		inference: lmStudioInferenceConfig(input.config),
		structuredOutputContracts: PRODUCTION_STEP_OUTPUT_CONTRACTS,
	});
	const contract = PRODUCTION_STEP_OUTPUT_CONTRACTS[input.step];
	if (completion.text === null) {
		throw new ContextBenchmarkCommandError(
			"model_response_mismatch",
			`${input.step} returned no textual completion`,
		);
	}
	return {
		completion,
		row: {
			message_load: input.messageLoad,
			production_step: input.step,
			prompt_sha256: await modelRequestSha256(input.prompt),
			request_sha256: sha256Json(requestBody),
			structured_output: {
				name: contract.name,
				schema_sha256: sha256Json(contract.schema),
				enforcement: "lmstudio_json_schema",
			},
			fixed_input_tokens: fixedInputTokens,
			evidence_or_draft_tokens: evidenceOrDraftTokens,
			runtime_delta_tokens: runtimeDeltaTokens,
			input_tokens: completion.token_usage.input_tokens,
			completion_tokens: completion.token_usage.output_tokens,
			total_tokens: completion.token_usage.total_tokens,
			context_headroom_tokens: contextHeadroomTokens,
			completion_bytes: Buffer.byteLength(completion.text),
		},
	};
}

async function benchmarkLoad(input: {
	readonly messageLoad: number;
	readonly evidence: PreparedEvidence;
	readonly canonical: PreparedEvidence;
	readonly configs: Readonly<Record<CurrentProductionModelStep, LmStudioAdapterConfig>>;
	readonly providers: Readonly<Record<CurrentProductionModelStep, ModelProviderPort>>;
	readonly model: ContextBenchmarkModel;
}): Promise<ContextBenchmarkRow[]> {
	const rows: ContextBenchmarkRow[] = [];
	const complete = async (
		step: CurrentProductionModelStep,
		prompt: ContextBenchmarkPrompt,
	) => {
		const measured = await measureCompletion({
			messageLoad: input.messageLoad,
			step,
			prompt,
			baseline: baselinePrompt(step, input.canonical),
			config: input.configs[step],
			provider: input.providers[step],
			model: input.model,
		});
		rows.push(measured.row);
	};

	await complete("main_story_write", {
		system: WRITER_SYSTEM_CONSTRAINTS,
		user: buildMainStoryWriterPrompt(input.evidence),
	});
	await complete("announcements_write", {
		system: WRITER_SYSTEM_CONSTRAINTS,
		user: buildAnnouncementsWriterPrompt(input.evidence),
	});
	return rows;
}

export async function runContextBenchmark(
	options: ContextBenchmarkCommandOptions,
): Promise<{ readonly path: string; readonly report: ContextBenchmarkFileV3 }> {
	const environment = options.environment ?? process.env;
	const config = parseLmStudioConfig(environment);
	lmStudioSdkBaseUrl(config.baseUrl);
	const now = options.now ?? (() => new Date());
	const loadedFixture = await loadFixture(options.fixturePath);
	const canonical = prepareEvidence({
		activeRegionId: loadedFixture.fixture.active_region_id,
		publicationDate: loadedFixture.publicationDate,
		messages: loadedFixture.fixture.messages,
	});
	if (canonical.final_count !== 208) {
		throw new ContextBenchmarkCommandError(
			"prepared_ceiling_mismatch",
			`Canonical prepared evidence ceiling must be 208, got ${canonical.final_count}`,
		);
	}
	const runtime = options.runtime ?? createLmStudioContextBenchmarkRuntime(config.baseUrl);
	const startedAt = now().toISOString();
	let model: ContextBenchmarkModel;
	let rows: ContextBenchmarkRow[] = [];
	try {
		model = await runtime.getOnlyLoadedQwen();
		assertConfiguredModel(config.steps.main_story_write.model, model);
		const providers: Record<CurrentProductionModelStep, ModelProviderPort> = {
			main_story_write: resolveModelProvider(
				"main_story_write",
				config.steps.main_story_write,
				environment,
			),
			announcements_write: resolveModelProvider(
				"announcements_write",
				config.steps.announcements_write,
				environment,
			),
		};
		for (const messageLoad of CONTEXT_BENCHMARK_LOADS) {
			rows = rows.concat(await benchmarkLoad({
				messageLoad,
				evidence: projectedEvidence(canonical, messageLoad),
				canonical,
				configs: config.steps,
				providers,
				model,
			}));
		}
	} finally {
		await runtime.close();
	}
	const report = ContextBenchmarkFileV3Schema.parse({
		version: 3,
		id: generateContextBenchmarkId(),
		fixture: {
			path: relative(WORKSPACE_ROOT, loadedFixture.path),
			fixture_sha256: loadedFixture.fixtureSha256,
			prepared_message_ceiling: 208,
		},
		loads: CONTEXT_BENCHMARK_LOADS,
		model: {
			identifier: model.identifier,
			model_key: model.modelKey,
			path: model.path,
			display_name: model.displayName,
			context_length: model.contextLength,
			measurement_runtime: "lmstudio_sdk_1.5",
		},
		agent_configurations: {
			main_story_write: retainedAgentConfiguration(config.steps.main_story_write),
			announcements_write: retainedAgentConfiguration(config.steps.announcements_write),
		},
		rows,
		started_at: startedAt,
		completed_at: now().toISOString(),
	});
	const path = await saveContextBenchmarkFile(report, options.resultsDirectory);
	return { path, report };
}
