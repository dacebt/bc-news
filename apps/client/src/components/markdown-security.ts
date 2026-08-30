import type { Options } from "rehype-sanitize";

export const GAME_REFERENCE_TOKEN_ATTRIBUTE = "data-game-reference-token";

export const ALLOWED_MARKDOWN_ELEMENTS = ["p", "strong", "em", "a"] as const;

// Model-authored game-chat prose has no attributes, URLs, or embedded content.
// Unsupported markup unwraps to inert text; active elements never enter the DOM.
export const MARKDOWN_SANITIZE_SCHEMA: Options = {
	tagNames: [...ALLOWED_MARKDOWN_ELEMENTS],
	attributes: {
		a: [GAME_REFERENCE_TOKEN_ATTRIBUTE],
	},
	protocols: {},
	strip: ["script", "style"],
};
