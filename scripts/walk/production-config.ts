import { readFile } from "node:fs/promises";
import { flattenDiagnosticMessageText, parseConfigFileTextToJson } from "typescript";

type WranglerConfigSource = {
	path: string;
	source: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
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
	if (
		!isRecord(secrets) ||
		!Array.isArray(secrets["required"]) ||
		secrets["required"].length !== 1 ||
		secrets["required"][0] !== "OPERATOR_API_TOKEN"
	) {
		throw new Error(
			`Wrangler config ${generationInput.path} must require exactly OPERATOR_API_TOKEN`,
		);
	}
	const generationVars = generation["vars"];
	if (isRecord(generationVars) && hasOwn(generationVars, "OPERATOR_API_TOKEN")) {
		throw new Error(
			`Wrangler config ${generationInput.path} must not define OPERATOR_API_TOKEN in vars`,
		);
	}

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
