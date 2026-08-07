import { Box } from "@chakra-ui/react";
import Markdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import {
	ALLOWED_MARKDOWN_ELEMENTS,
	MARKDOWN_SANITIZE_SCHEMA,
} from "./markdown-security";

export function NewspaperText({ text }: { text: string }) {
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
				rehypePlugins={[[rehypeSanitize, MARKDOWN_SANITIZE_SCHEMA]]}
				skipHtml
				unwrapDisallowed
			>
				{text}
			</Markdown>
		</Box>
	);
}
