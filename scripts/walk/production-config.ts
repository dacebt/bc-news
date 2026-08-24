import { readFile } from "node:fs/promises";
import { flattenDiagnosticMessageText, parseConfigFileTextToJson } from "typescript";

type WranglerConfigSource = {
	path: string;
	source: string;
};

const REQUIRED_GENERATION_SECRETS = [
	"CF_AI_GATEWAY_API_TOKEN",
	"OPERATOR_API_TOKEN",
] as const;

const PRODUCTION_MODEL = "google/gemini-3.1-flash-lite";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item: unknown) => typeof item === "string");
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(record, key);
}

function parseWranglerConfig(input: WranglerConfigSource): Record<string, unknown> {
	const parsed = parseConfigFileTextToJson(input.path, input.source);
	if (parsed.error !== undefined) {
		throw new Error(
			`Wrangler config ${input.path} is invalid JSONC: ${flattenDiagnosticMessageText(parsed.error.messageText, "\n")}`,
		);
	}
	if (!isRecord(parsed.config)) {
		throw new Error(`Wrangler config ${input.path} must define a root object`);
	}
	return parsed.config;
}

function assertPrivateWorker(config: Record<string, unknown>, configPath: string): void {
	for (const key of ["workers_dev", "preview_urls"] as const) {
		if (config[key] !== false) {
			throw new Error(`Wrangler config ${configPath} must set ${key} to false`);
		}
	}
}

function assertGenerationModelConfig(
	config: Record<string, unknown>,
	configPath: string,
): void {
	const vars = config["vars"];
	if (!isRecord(vars) || typeof vars["MODEL_CONFIG"] !== "string") {
		throw new Error(`Wrangler config ${configPath} must define MODEL_CONFIG as a JSON string`);
	}
	let modelConfig: unknown;
	try {
		modelConfig = JSON.parse(vars["MODEL_CONFIG"]);
	} catch {
		throw new Error(`Wrangler config ${configPath} MODEL_CONFIG must be valid JSON`);
	}
	if (!isRecord(modelConfig)) {
		throw new Error(`Wrangler config ${configPath} MODEL_CONFIG must be an object`);
	}
	const writerSteps = ["main_story_write", "announcements_write"] as const;
	if (
		Object.keys(modelConfig).length !== writerSteps.length
		|| writerSteps.some((step) => {
			const writer = modelConfig[step];
			return !isRecord(writer)
				|| Object.keys(writer).length !== 2
				|| writer["adapter"] !== "cloudflare_ai_gateway"
				|| writer["model"] !== PRODUCTION_MODEL;
		})
	) {
		throw new Error(
			`Wrangler config ${configPath} must select ${PRODUCTION_MODEL} through cloudflare_ai_gateway for both writers`,
		);
	}
}

function productionDatabase(config: Record<string, unknown>, configPath: string): Record<string, unknown> {
	const databases = config["d1_databases"];
	if (!Array.isArray(databases) || databases.length !== 1 || !isRecord(databases[0])) {
		throw new Error(
			`Wrangler config ${configPath} must define exactly one d1_databases entry`,
		);
	}
	if (databases[0]["binding"] !== "DB") {
		throw new Error(`Wrangler config ${configPath} must bind its D1 database as DB`);
	}
	for (const key of ["database_name", "database_id"] as const) {
		const value = databases[0][key];
		if (typeof value !== "string" || value.trim().length === 0) {
			throw new Error(`Wrangler config ${configPath} must define a nonblank ${key}`);
		}
	}
	return databases[0];
}

export function assertProductionWranglerConfigs(
	generationInput: WranglerConfigSource,
	ingestInput: WranglerConfigSource,
): void {
	const generation = parseWranglerConfig(generationInput);
	const ingest = parseWranglerConfig(ingestInput);
	for (const [config, configPath] of [
		[generation, generationInput.path],
		[ingest, ingestInput.path],
	] as const) {
		if (hasOwn(config, "env")) {
			throw new Error(`Wrangler config ${configPath} must not define named environments`);
		}
	}
	if (generation["keep_vars"] !== true) {
		throw new Error(
			`Wrangler config ${generationInput.path} must set keep_vars to true for dashboard-owned runtime variables`,
		);
	}
	assertPrivateWorker(generation, generationInput.path);
	assertPrivateWorker(ingest, ingestInput.path);

	const generationDatabase = productionDatabase(generation, generationInput.path);
	const ingestDatabase = productionDatabase(ingest, ingestInput.path);
	for (const key of ["database_name", "database_id"] as const) {
		if (generationDatabase[key] !== ingestDatabase[key]) {
			throw new Error(`Production Wrangler configs must use the same ${key}`);
		}
	}

	const migrationsDirectory = generationDatabase["migrations_dir"];
	if (
		!hasOwn(generationDatabase, "migrations_dir") ||
		typeof migrationsDirectory !== "string" ||
		migrationsDirectory.trim().length === 0
	) {
		throw new Error(
			`Wrangler config ${generationInput.path} must own a nonblank migrations_dir`,
		);
	}
	if (hasOwn(ingestDatabase, "migrations_dir")) {
		throw new Error(`Wrangler config ${ingestInput.path} must not own migrations_dir`);
	}

	const secrets = generation["secrets"];
	const requiredSecrets = isRecord(secrets) && isStringArray(secrets["required"])
		? [...secrets["required"]].sort()
		: undefined;
	if (
		requiredSecrets === undefined
		|| requiredSecrets.length !== REQUIRED_GENERATION_SECRETS.length
		|| requiredSecrets.some((secret, index) => secret !== REQUIRED_GENERATION_SECRETS[index])
	) {
		throw new Error(
			`Wrangler config ${generationInput.path} must require exactly CF_AI_GATEWAY_API_TOKEN and OPERATOR_API_TOKEN`,
		);
	}
	const generationVars = generation["vars"];
	if (isRecord(generationVars)) {
		for (const secret of REQUIRED_GENERATION_SECRETS) {
			if (hasOwn(generationVars, secret)) {
				throw new Error(
					`Wrangler config ${generationInput.path} must not define ${secret} in vars`,
				);
			}
		}
	}
	assertGenerationModelConfig(generation, generationInput.path);

	for (const key of ["route", "routes", "assets"] as const) {
		if (hasOwn(ingest, key)) {
			throw new Error(`Wrangler config ${ingestInput.path} must not own ${key}`);
		}
	}
}

export async function readAndAssertProductionWranglerConfigs(
	generationPath: string,
	ingestPath: string,
): Promise<void> {
	const [generationSource, ingestSource] = await Promise.all([
		readFile(generationPath, "utf8"),
		readFile(ingestPath, "utf8"),
	]);
	assertProductionWranglerConfigs(
		{ path: generationPath, source: generationSource },
		{ path: ingestPath, source: ingestSource },
	);
}
