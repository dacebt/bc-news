import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const RECORDED_MODEL_CONFIG = JSON.stringify({
	main_story_write: { adapter: "recorded" },
	announcements_write: { adapter: "recorded" },
});

export default defineConfig(async () => {
	const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
	return {
		resolve: {
			alias: {
				"@lmstudio/sdk": path.resolve(import.meta.dirname, "tests/lmstudio-sdk-double.ts"),
			},
		},
		plugins: [
			cloudflareTest({
				wrangler: { configPath: "./tests/wrangler.jsonc" },
				miniflare: {
					bindings: {
						OPERATOR_API_TOKEN: "test-operator-token",
						EVIDENCE_INPUT: "d1_chat",
						MODEL_CONFIG: RECORDED_MODEL_CONFIG,
						LMSTUDIO_BASE_URL: "",
						HOSTED_MODEL_BASE_URL: "",
						HOSTED_MODEL_API_KEY: "",
						TEST_MIGRATIONS: migrations,
					},
				},
			}),
		],
		test: { setupFiles: ["./tests/apply-migrations.ts"] },
	};
});
