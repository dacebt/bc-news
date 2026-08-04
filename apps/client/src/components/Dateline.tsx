import { Grid, Text } from "@chakra-ui/react";
import { PAPER_SERIF_NARROW } from "./typography";

const DATELINE_FORMAT = new Intl.DateTimeFormat("en-US", {
	weekday: "long",
	year: "numeric",
	month: "long",
	day: "numeric",
	timeZone: "UTC",
});

function formatDatelineDate(publicationDate: string): string {
	return DATELINE_FORMAT.format(new Date(`${publicationDate}T00:00:00Z`)).toUpperCase();
}

interface DatelineProps {
	activeRegionId: string;
	publicationDate: string;
}

export function Dateline({ activeRegionId, publicationDate }: DatelineProps) {
	return (
		<Grid
			templateColumns="1fr 1fr"
			gap={3}
			color="paper.muted"
			textTransform="uppercase"
			letterSpacing="widest"
			fontWeight="bold"
			fontFamily={PAPER_SERIF_NARROW}
		>
			<Text textAlign="left" fontSize="xs">
				{formatDatelineDate(publicationDate)} · REGION {activeRegionId}
			</Text>
			<Text textAlign="right" fontSize="xs">
				EDITION
			</Text>
		</Grid>
	);
}
