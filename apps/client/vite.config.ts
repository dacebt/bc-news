import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// react-markdown's parsing and rendering closure (remark/rehype/mdast/
// micromark/unist/hast/vfile plus its small string-utility leaves). React is
// deliberately not part of this list: the higher-priority group below owns
// the shared runtime used by both markdown and the newspaper shell.
const MARKDOWN_DEPENDENCY_PACKAGES = [
	"react-markdown",
	"remark-parse",
	"remark-rehype",
	"mdast-util-from-markdown",
	"mdast-util-mdx-expression",
	"mdast-util-mdx-jsx",
	"mdast-util-mdxjs-esm",
	"mdast-util-phrasing",
	"mdast-util-to-hast",
	"mdast-util-to-markdown",
	"mdast-util-to-string",
	"micromark",
	"micromark-core-commonmark",
	"micromark-factory-destination",
	"micromark-factory-label",
	"micromark-factory-space",
	"micromark-factory-title",
	"micromark-factory-whitespace",
	"micromark-util-character",
	"micromark-util-chunked",
	"micromark-util-classify-character",
	"micromark-util-combine-extensions",
	"micromark-util-decode-numeric-character-reference",
	"micromark-util-decode-string",
	"micromark-util-encode",
	"micromark-util-html-tag-name",
	"micromark-util-normalize-identifier",
	"micromark-util-resolve-all",
	"micromark-util-sanitize-uri",
	"micromark-util-subtokenize",
	"micromark-util-symbol",
	"micromark-util-types",
	"unist-util-is",
	"unist-util-position",
	"unist-util-stringify-position",
	"unist-util-visit",
	"unist-util-visit-parents",
	"hast-util-to-jsx-runtime",
	"hast-util-whitespace",
	"unified",
	"vfile",
	"vfile-message",
	"bail",
	"trough",
	"devlop",
	"dequal",
	"extend",
	"is-plain-obj",
	"decode-named-character-reference",
	"character-entities",
	"character-entities-html4",
	"character-entities-legacy",
	"character-reference-invalid",
	"comma-separated-tokens",
	"space-separated-tokens",
	"property-information",
	"html-url-attributes",
	"trim-lines",
	"zwitch",
	"ccount",
	"parse-entities",
	"is-alphabetical",
	"is-alphanumerical",
	"is-decimal",
	"is-hexadecimal",
	"longest-streak",
	"stringify-entities",
	"style-to-js",
	"style-to-object",
	"inline-style-parser",
	"estree-util-is-identifier-name",
	"@ungap/structured-clone",
];

// Shared by both the newspaper shell and react-markdown. This group has the
// higher priority because Rolldown recursively considers dependencies for a
// manual group; React must be removed from markdown's candidate closure and
// emitted once as the actual shared runtime.
const REACT_RUNTIME_PACKAGES = ["react", "react-dom", "scheduler"];

function isDependencyModule(id: string, packages: readonly string[]): boolean {
	const normalized = id.replaceAll("\\", "/");
	return packages.some((pkg) => normalized.includes(`/node_modules/${pkg}/`));
}

export default defineConfig({
	plugins: [react()],
	build: {
		rollupOptions: {
			output: {
				codeSplitting: {
					groups: [
						{
							name: "react-runtime",
							test: (id) => isDependencyModule(id, REACT_RUNTIME_PACKAGES),
							priority: 2,
						},
						{
							name: "markdown-renderer",
							test: (id) => isDependencyModule(id, MARKDOWN_DEPENDENCY_PACKAGES),
							priority: 1,
						},
					],
				},
			},
		},
	},
});
