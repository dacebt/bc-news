import { Box } from "@chakra-ui/react";
import Markdown from "react-markdown";
import { DISALLOWED_ELEMENTS } from "./markdown-security";

export function MarkdownText({ text }: { text: string }) {
	return (
		<Box>
			<Markdown disallowedElements={DISALLOWED_ELEMENTS} unwrapDisallowed>
				{text}
			</Markdown>
		</Box>
	);
}
