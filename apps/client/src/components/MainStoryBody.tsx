import { Box } from "@chakra-ui/react";
import Markdown from "react-markdown";

const DISALLOWED_ELEMENTS = ["script", "iframe", "object", "embed"];

export function MainStoryBody({ text }: { text: string }) {
	// Single newlines promote to paragraph breaks (v1's main-story readability rule).
	const paragraphText = text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.join("\n\n");

	return (
		<Box>
			<Markdown disallowedElements={DISALLOWED_ELEMENTS} unwrapDisallowed>
				{paragraphText}
			</Markdown>
		</Box>
	);
}
