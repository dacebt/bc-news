import { useEffect, useState } from "react";
import { Box, Flex, Grid, Text } from "@chakra-ui/react";
import {
	GenerationRunParamsSchema,
	type Edition,
	type GenerationRunParams,
} from "@bc-news/contracts";
import { getEdition } from "../api/edition";
import { Announcements } from "../components/Announcements";
import { Dateline } from "../components/Dateline";
import { MainStory } from "../components/MainStory";
import { Masthead } from "../components/Masthead";
import { PaperContent, PaperTextureLayer, PaperWrapper } from "../components/PaperSurface";
import { PAPER_SERIF_NARROW } from "../components/typography";

type EditionView =
	| { state: "loading" }
	| { state: "published"; edition: Edition }
	| { state: "unavailable" };

function editionIdentityFromUrl(): GenerationRunParams | undefined {
	const query = new URLSearchParams(window.location.search);
	const result = GenerationRunParamsSchema.safeParse({
		active_region_id: query.get("active_region_id"),
		publication_date: query.get("publication_date"),
	});
	return result.success ? result.data : undefined;
}

function PublishedPaper({ edition }: { edition: Edition }) {
	return (
		<PaperWrapper>
			<PaperTextureLayer />
			<PaperContent>
				<Box mb={6}>
					<Masthead title={edition.title} />
					<Dateline
						activeRegionId={edition.active_region_id}
						publicationDate={edition.publication_date}
					/>
				</Box>
				<Grid templateColumns={{ base: "1fr", lg: "2fr 1fr" }} gap={8}>
					<MainStory mainStory={edition.main_story} />
					<Announcements announcements={edition.announcements} />
				</Grid>
			</PaperContent>
		</PaperWrapper>
	);
}

function UnavailablePaper() {
	return (
		<PaperWrapper>
			<PaperTextureLayer />
			<PaperContent>
				<Flex justify="center" py={16}>
					<Text
						fontFamily={PAPER_SERIF_NARROW}
						fontSize="lg"
						fontStyle="italic"
						color="paper.muted"
					>
						No published edition.
					</Text>
				</Flex>
			</PaperContent>
		</PaperWrapper>
	);
}

export function EditionPage() {
	const [identity] = useState(() => editionIdentityFromUrl());
	const [view, setView] = useState<EditionView>(
		identity === undefined ? { state: "unavailable" } : { state: "loading" },
	);

	useEffect(() => {
		if (identity === undefined) {
			return;
		}
		let cancelled = false;
		getEdition(identity.active_region_id, identity.publication_date)
			.then((edition) => {
				if (!cancelled) setView({ state: "published", edition });
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				console.error("edition unavailable", error);
				setView({ state: "unavailable" });
			});
		return () => {
			cancelled = true;
		};
	}, [identity]);

	return (
		<Flex justify="center" bg="surface.base" minH="100vh" p={{ base: 4, md: 8 }}>
			{view.state === "published" && <PublishedPaper edition={view.edition} />}
			{view.state === "unavailable" && <UnavailablePaper />}
		</Flex>
	);
}
