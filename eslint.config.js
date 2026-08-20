import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{
		ignores: ["**/node_modules/", "**/dist/", "**/.wrangler/", "**/.worktrees/", "**/worker-configuration.d.ts", "apps/eval/local-data/"],
	},
	js.configs.recommended,
	tseslint.configs.recommendedTypeChecked,
	{
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	{
		files: ["apps/client/src/**/*.{ts,tsx}"],
		extends: [reactHooks.configs.flat["recommended-latest"]],
	},
	{
		files: ["**/*.js"],
		extends: [tseslint.configs.disableTypeChecked],
	},
);
