import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	assertProductionWranglerConfigs,
	readAndAssertProductionWranglerConfigs,
} from "../walk/production-config";

type Config = Record<string, unknown>;

const GENERATION_CONFIG: Config = {
	workers_dev: false,
	preview_urls: false,
	keep_vars: true,
	secrets: { required: ["CF_AI_GATEWAY_API_TOKEN", "OPERATOR_API_TOKEN"] },
	d1_databases: [
		{
			binding: "DB",
			database_name: "bc-news-editions",
			database_id: "database-id",
			migrations_dir: "migrations",
		},
	],
	vars: {
		MODEL_CONFIG: JSON.stringify({
			main_story_write: {
				adapter: "cloudflare_ai_gateway",
				model: "google/gemini-3.1-flash-lite",
			},
			announcements_write: {
				adapter: "cloudflare_ai_gateway",
				model: "google/gemini-3.1-flash-lite",
			},
		}),
	},
};

const INGEST_CONFIG: Config = {
	workers_dev: false,
	preview_urls: false,
	d1_databases: [
		{
			binding: "DB",
			database_name: "bc-news-editions",
			database_id: "database-id",
		},
	],
};

function cloneConfig(config: Config): Config {
	return structuredClone(config);
}

function isConfig(value: unknown): value is Config {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function database(config: Config): Config {
	const databases = config["d1_databases"];
	assert.ok(Array.isArray(databases));
	const entry: unknown = databases[0];
	assert.ok(isConfig(entry));
	return entry;
}

function assertPair(generation: Config, ingest: Config): void {
	assertProductionWranglerConfigs(
		{ path: "generation.jsonc", source: JSON.stringify(generation) },
		{ path: "ingest.jsonc", source: JSON.stringify(ingest) },
	);
}

void test("accepts both real production Worker configurations", async () => {
	const testsDirectory = dirname(fileURLToPath(import.meta.url));
	await assert.doesNotReject(
		readAndAssertProductionWranglerConfigs(
			join(testsDirectory, "..", "..", "apps", "generation", "wrangler.jsonc"),
			join(testsDirectory, "..", "..", "apps", "ingest", "wrangler.jsonc"),
		),
	);
});

void test("rejects invalid JSONC before checking production invariants", () => {
	assert.throws(
		() =>
			assertProductionWranglerConfigs(
				{ path: "generation.jsonc", source: `{ "workers_dev": false,, }` },
				{ path: "ingest.jsonc", source: JSON.stringify(INGEST_CONFIG) },
			),
		/invalid JSONC/,
	);
});

void test("rejects a Worker exposed through workers.dev or preview URLs", () => {
	for (const value of [true, "false", undefined]) {
		for (const [worker, key] of [
			["generation", "workers_dev"],
			["generation", "preview_urls"],
			["ingest", "workers_dev"],
			["ingest", "preview_urls"],
		] as const) {
			const generation = cloneConfig(GENERATION_CONFIG);
			const ingest = cloneConfig(INGEST_CONFIG);
			const config = worker === "generation" ? generation : ingest;
			if (value === undefined) delete config[key];
			else config[key] = value;
			assert.throws(() => assertPair(generation, ingest), new RegExp(`must set ${key} to false`));
		}
	}
});

void test("rejects named environments that could override the frozen boundary", () => {
	for (const worker of ["generation", "ingest"] as const) {
		const generation = cloneConfig(GENERATION_CONFIG);
		const ingest = cloneConfig(INGEST_CONFIG);
		const config = worker === "generation" ? generation : ingest;
		config["env"] = {
			production: {
				workers_dev: true,
				preview_urls: true,
				routes: ["exposed.example.com/*"],
			},
		};
		assert.throws(
			() => assertPair(generation, ingest),
			/must not define named environments/,
		);
	}
});

void test("preserves dashboard-owned runtime variables across deployment", () => {
	const generation = cloneConfig(GENERATION_CONFIG);
	delete generation["keep_vars"];
	assert.throws(
		() => assertPair(generation, cloneConfig(INGEST_CONFIG)),
		/must set keep_vars to true/,
	);
});

void test("rejects an absent, extra, or incorrectly bound D1 database", () => {
	for (const databases of [
		[],
		[{}, {}],
		[{ binding: "OTHER", database_name: "bc-news-editions", database_id: "database-id" }],
	]) {
		const ingest = cloneConfig(INGEST_CONFIG);
		ingest["d1_databases"] = databases;
		assert.throws(() => assertPair(cloneConfig(GENERATION_CONFIG), ingest), /d1_databases|bind its D1 database as DB/);
	}
});

void test("rejects blank or mismatched shared D1 identity", () => {
	for (const [key, value, expected] of [
		["database_name", " ", /nonblank database_name/],
		["database_id", " ", /nonblank database_id/],
		["database_name", "other-editions", /same database_name/],
		["database_id", "other-id", /same database_id/],
	] as const) {
		const ingest = cloneConfig(INGEST_CONFIG);
		database(ingest)[key] = value;
		assert.throws(() => assertPair(cloneConfig(GENERATION_CONFIG), ingest), expected);
	}
});

void test("enforces generation-only migration ownership", () => {
	const missing = cloneConfig(GENERATION_CONFIG);
	delete database(missing)["migrations_dir"];
	assert.throws(
		() => assertPair(missing, cloneConfig(INGEST_CONFIG)),
		/must own a nonblank migrations_dir/,
	);

	const blank = cloneConfig(GENERATION_CONFIG);
	database(blank)["migrations_dir"] = " ";
	assert.throws(
		() => assertPair(blank, cloneConfig(INGEST_CONFIG)),
		/must own a nonblank migrations_dir/,
	);

	const ingest = cloneConfig(INGEST_CONFIG);
	database(ingest)["migrations_dir"] = "migrations";
	assert.throws(
		() => assertPair(cloneConfig(GENERATION_CONFIG), ingest),
		/must not own migrations_dir/,
	);
});

void test("requires the exact generation runtime secrets", () => {
	for (const required of [
		[],
		["OTHER"],
		["OPERATOR_API_TOKEN"],
		["CF_AI_GATEWAY_API_TOKEN", "OPERATOR_API_TOKEN", "OTHER"],
	]) {
		const generation = cloneConfig(GENERATION_CONFIG);
		generation["secrets"] = { required };
		assert.throws(
			() => assertPair(generation, cloneConfig(INGEST_CONFIG)),
			/must require exactly CF_AI_GATEWAY_API_TOKEN and OPERATOR_API_TOKEN/,
		);
	}

	for (const secret of ["CF_AI_GATEWAY_API_TOKEN", "OPERATOR_API_TOKEN"]) {
		const generation = cloneConfig(GENERATION_CONFIG);
		const vars = generation["vars"];
		assert.ok(isConfig(vars));
		vars[secret] = "plaintext";
		assert.throws(
			() => assertPair(generation, cloneConfig(INGEST_CONFIG)),
			new RegExp(`must not define ${secret} in vars`),
		);
	}
});

void test("requires Gemini 3.1 through AI Gateway for both production writers", () => {
	for (const modelConfig of [
		"not-json",
		JSON.stringify({
			main_story_write: { adapter: "recorded" },
			announcements_write: { adapter: "recorded" },
		}),
		JSON.stringify({
			main_story_write: {
				adapter: "cloudflare_ai_gateway",
				model: "google/gemini-3.1-flash-lite",
			},
		}),
		JSON.stringify({
			main_story_write: {
				adapter: "cloudflare_ai_gateway",
				model: "google/gemini-3.1-flash-lite",
			},
			announcements_write: {
				adapter: "cloudflare_ai_gateway",
				model: "google/gemini-3.5-flash-lite",
			},
		}),
	]) {
		const generation = cloneConfig(GENERATION_CONFIG);
		generation["vars"] = { MODEL_CONFIG: modelConfig };
		assert.throws(
			() => assertPair(generation, cloneConfig(INGEST_CONFIG)),
			/MODEL_CONFIG|must select google\/gemini-3.1-flash-lite/,
		);
	}
});

void test("rejects deployable ingest HTTP surfaces", () => {
	for (const key of ["route", "routes", "assets"] as const) {
		const ingest = cloneConfig(INGEST_CONFIG);
		ingest[key] = key === "assets" ? { directory: "dist" } : "example.com/*";
		assert.throws(
			() => assertPair(cloneConfig(GENERATION_CONFIG), ingest),
			new RegExp(`must not own ${key}`),
		);
	}
});
