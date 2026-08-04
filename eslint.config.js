import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{
		ignores: ["**/node_modules/", "**/dist/", "**/.wrangler/", "**/worker-configuration.d.ts"],
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
		files: ["**/*.js"],
		extends: [tseslint.configs.disableTypeChecked],
	},
);
