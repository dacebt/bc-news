import { Box, Flex, Heading, Text } from "@chakra-ui/react";
import type { MainStory as MainStoryContent } from "@bc-news/contracts";
import { MainStoryBody } from "./MainStoryBody";
import { PAPER_SERIF_NARROW } from "./typography";

const TWO_COLUMN_MIN_BODY_LENGTH = 1200;

export function MainStory({ mainStory }: { mainStory: MainStoryContent }) {
	return (
		<Flex direction="column" gap={4}>
			<Heading
				as="h2"
				fontSize={{ base: "2xl", md: "3xl" }}
				fontWeight="bold"
				lineHeight="tight"
				textAlign="center"
			>
				{mainStory.headline}
			</Heading>
			<Text
				color="paper.ink"
				fontSize="lg"
				fontStyle="italic"
				fontWeight="medium"
				lineHeight="relaxed"
				textAlign="center"
				px={4}
			>
				{mainStory.lede}
			</Text>
			<Box
				fontSize="md"
				lineHeight="1.75"
				sx={{
					...(mainStory.body.length >= TWO_COLUMN_MIN_BODY_LENGTH && {
						"@media (min-width: 768px)": {
							columnCount: 2,
							columnGap: "2.5rem",
							columnRule: "0.5px solid",
							columnRuleColor: "rgba(212, 212, 212, 0.6)",
						},
					}),
					"& > div > p:first-of-type::first-letter": {
						float: "left",
						fontSize: "4em",
						lineHeight: "0.85",
						fontWeight: "bold",
						marginRight: "0.08em",
						marginTop: "0.05em",
						fontFamily: PAPER_SERIF_NARROW,
					},
					"& > div > p": {
						marginBottom: "1em",
						textAlign: "left",
					},
					"& > div > p:last-child": {
						marginBottom: 0,
					},
				}}
			>
				<MainStoryBody text={mainStory.body} />
			</Box>
		</Flex>
	);
}
