import { Box, Heading } from "@chakra-ui/react";
import { PAPER_SERIF } from "./typography";

export function Masthead({ title }: { title: string }) {
	return (
		<Box>
			<Heading
				as="h1"
				fontSize={{ base: "5xl", md: "7xl" }}
				fontWeight="black"
				textAlign="center"
				letterSpacing="tighter"
				fontFamily={PAPER_SERIF}
				mb={3}
				lineHeight="1"
			>
				{title}
			</Heading>
			<Box borderTop="4px solid" borderColor="paper.rule" mb={1} />
			<Box borderTop="1px solid" borderColor="paper.rule" mb={4} />
		</Box>
	);
}
