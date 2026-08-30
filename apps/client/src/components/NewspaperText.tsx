import { coordGameReferenceDestination } from "@bc-news/contracts";
import { Box } from "@chakra-ui/react";
import type { ComponentPropsWithoutRef } from "react";
import Markdown from "react-markdown";
import type { Components } from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import type { EditionGameReference } from "../api/edition";
import {
	ALLOWED_MARKDOWN_ELEMENTS,
	GAME_REFERENCE_TOKEN_ATTRIBUTE,
	MARKDOWN_SANITIZE_SCHEMA,
} from "./markdown-security";

type MarkdownNode = {
	type: string;
	children?: MarkdownNode[];
	value?: string;
	data?: {
		hProperties?: Record<string, string>;
	};
	url?: string;
};

const EMPTY_GAME_REFERENCES: readonly EditionGameReference[] = [];

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildTokenMatcher(tokens: readonly string[]): RegExp | null {
	if (tokens.length === 0) {
		return null;
	}
	return new RegExp(tokens.map(escapeRegExp).sort((left, right) => right.length - left.length).join("|"), "g");
}

function createReferenceLink(reference: EditionGameReference): MarkdownNode {
	return {
		type: "link",
		url: "",
		data: {
			hProperties: {
				[GAME_REFERENCE_TOKEN_ATTRIBUTE]: reference.token,
			},
		},
		children: [{ type: "text", value: reference.display_text }],
	};
}

function replaceReferenceTokens(
	text: string,
	referenceByToken: ReadonlyMap<string, EditionGameReference>,
	tokenMatcher: RegExp | null,
): MarkdownNode[] {
	if (tokenMatcher === null) {
		return [{ type: "text", value: text }];
	}

	tokenMatcher.lastIndex = 0;
	const replacedChildren: MarkdownNode[] = [];
	let cursor = 0;

	for (const match of text.matchAll(tokenMatcher)) {
		const start = match.index ?? 0;
		const token = match[0];
		const reference = referenceByToken.get(token);
		if (!reference) {
			continue;
		}
		if (start > cursor) {
			replacedChildren.push({ type: "text", value: text.slice(cursor, start) });
		}
		replacedChildren.push(createReferenceLink(reference));
		cursor = start + token.length;
	}

	if (replacedChildren.length === 0) {
		return [{ type: "text", value: text }];
	}
	if (cursor < text.length) {
		replacedChildren.push({ type: "text", value: text.slice(cursor) });
	}
	return replacedChildren;
}

function transformReferenceTokens(
	node: MarkdownNode,
	referenceByToken: ReadonlyMap<string, EditionGameReference>,
	tokenMatcher: RegExp | null,
): void {
	if (!node.children || node.type === "link" || node.type === "linkReference") {
		return;
	}

	for (let index = 0; index < node.children.length; index += 1) {
		const child = node.children[index];
		if (!child) {
			continue;
		}
		if (child.type === "text" && typeof child.value === "string") {
			const replacement = replaceReferenceTokens(child.value, referenceByToken, tokenMatcher);
			node.children.splice(index, 1, ...replacement);
			index += replacement.length - 1;
			continue;
		}
		transformReferenceTokens(child, referenceByToken, tokenMatcher);
	}
}

function remarkGameReferenceTokens(gameReferences: readonly EditionGameReference[] = []) {
	const referenceByToken = new Map(gameReferences.map((reference) => [reference.token, reference]));
	const tokenMatcher = buildTokenMatcher(gameReferences.map((reference) => reference.token));

	return (tree: MarkdownNode) => {
		transformReferenceTokens(tree, referenceByToken, tokenMatcher);
	};
}

type GameReferenceAnchorProps = ComponentPropsWithoutRef<"a"> & {
	"data-game-reference-token"?: string;
};

function renderGameReferenceAnchor(
	referenceByToken: ReadonlyMap<string, EditionGameReference>,
): NonNullable<Components["a"]> {
	return function GameReferenceAnchor({ children, ...props }: GameReferenceAnchorProps) {
		const token = props[GAME_REFERENCE_TOKEN_ATTRIBUTE];
		if (typeof token !== "string") {
			return <>{children}</>;
		}
		const reference = referenceByToken.get(token);
		if (!reference) {
			return <>{children}</>;
		}
		return (
			<a
				href={coordGameReferenceDestination(reference.northing, reference.easting)}
				target="_blank"
				rel="noopener noreferrer"
			>
				{reference.display_text}
			</a>
		);
	};
}

export function NewspaperText({
	text,
	gameReferences = EMPTY_GAME_REFERENCES,
}: {
	text: string;
	gameReferences?: readonly EditionGameReference[];
}) {
	const referenceByToken = new Map(gameReferences.map((reference) => [reference.token, reference]));
	const components: Components = {
		a: renderGameReferenceAnchor(referenceByToken),
	};

	return (
		<Box
			sx={{
				"& > p": {
					marginBottom: "1em",
				},
				"& > p:last-child": {
					marginBottom: 0,
				},
				"& strong": {
					fontWeight: "bold",
				},
				"& em": {
					fontStyle: "italic",
				},
			}}
		>
			<Markdown
				allowedElements={ALLOWED_MARKDOWN_ELEMENTS}
				components={components}
				remarkPlugins={[[remarkGameReferenceTokens, gameReferences]]}
				rehypePlugins={[[rehypeSanitize, MARKDOWN_SANITIZE_SCHEMA]]}
				skipHtml
				unwrapDisallowed
			>
				{text}
			</Markdown>
		</Box>
	);
}
