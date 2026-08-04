import { defineConfig } from "vitest/config";

// Pinned to a zone behind UTC, and deliberately not UTC itself: a UTC-pinned
// suite cannot tell UTC arithmetic apart from a local-clock read that happens
// to agree with it. An assignment here (not vitest's `test.env`) because this
// file is evaluated with the config, before the test worker spawns -- only a
// TZ already present at spawn time takes effect.
process.env.TZ = "America/New_York";

export default defineConfig({
	test: {
		include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
		environment: "jsdom",
		setupFiles: ["tests/setup.ts"],
	},
});
