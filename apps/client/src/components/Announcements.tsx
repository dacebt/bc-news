import { Box, Divider, Flex, Heading, Text } from "@chakra-ui/react";
import type { Announcement } from "@bc-news/contracts";
import { MarkdownText } from "./MarkdownText";

export function Announcements({ announcements }: { announcements: Announcement[] }) {
	return (
		<Box>
			<Heading
				as="h3"
				fontSize="lg"
				fontWeight="bold"
				textTransform="uppercase"
				letterSpacing="wide"
				mb={4}
				pb={2}
				borderBottom="1px solid"
				borderColor="paper.rule"
			>
				Announcements
			</Heading>
			<Flex direction="column" gap={0}>
				{announcements.length ? (
					announcements.map((announcement, index) => (
						<Box key={index}>
							<Box py={3}>
								<Heading as="h4" fontSize="md" fontWeight="bold" mb={2}>
									{announcement.title}
								</Heading>
								<Box fontSize="sm" color="paper.ink" lineHeight="1.5">
									<MarkdownText text={announcement.summary} />
								</Box>
							</Box>
							{index < announcements.length - 1 && <Divider borderColor="paper.rule" />}
						</Box>
					))
				) : (
					<Text fontSize="sm" color="paper.muted" fontStyle="italic">
						No announcements available.
					</Text>
				)}
			</Flex>
		</Box>
	);
}
