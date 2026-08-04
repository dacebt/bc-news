import { Box } from "@chakra-ui/react";
import Markdown from "react-markdown";

// Raw HTML never renders: react-markdown skips HTML nodes by default, and the
// disallowed list keeps active-content elements out even if a plugin changes that.
const DISALLOWED_ELEMENTS = ["script", "iframe", "object", "embed"];

export function MarkdownText({ text }: { text: string }) {
	return (
		<Box>
			<Markdown disallowedElements={DISALLOWED_ELEMENTS} unwrapDisallowed>
				{text}
			</Markdown>
		</Box>
	);
}
