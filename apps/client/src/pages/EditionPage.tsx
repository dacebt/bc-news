import { useEffect, useState } from "react";
import { Box, Flex, Grid, Spinner, Text } from "@chakra-ui/react";
import type { Edition } from "@bc-news/contracts";
import { getEdition } from "../api/edition";
import { Announcements } from "../components/Announcements";
import { ControlsBar } from "../components/ControlsBar";
import { Dateline } from "../components/Dateline";
import { EditionOutcomeAlert, type EditionDisplayError } from "../components/EditionOutcomeAlert";
import { MainStory } from "../components/MainStory";
import { Masthead } from "../components/Masthead";
import { PaperContent, PaperTextureLayer, PaperWrapper } from "../components/PaperSurface";
import { useEditionDateRange } from "../dates/use-edition-date-range";
import {
	EDITION_WAITING_CUTOFF_UTC_MINUTES,
	formatLocalExpectedAvailabilityTime,
} from "../dates/publish-time";
import type { EditionSelection } from "../selection/edition-selection";
import { useEditionSelection } from "../selection/use-edition-selection";

function PublishedPaper({ edition }: { edition: Edition }) {
	return (
		<Flex justify="center" p={{ base: 4, md: 8 }}>
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
		</Flex>
	);
}

// Waiting only applies to the pair a completed response actually answered
// for, never the reader's still-pending selection - a fetch that resolved to
// "not found" grades against the request that produced that answer, not
// whatever the reader has since typed into the date field. `todayUtc` must be
// derived from the same `now` this is called with, never from
// `dateRange.maxDate` - that value only moves when the rollover timer fires,
// so across UTC midnight it can read yesterday for as long as the timer is
// late (a throttled background tab routinely delays it tens of seconds or
// more), grading a stale pair against a fresh clock.
function isWaitingForTodaysEdition(pairDate: string, todayUtc: string, now: Date): boolean {
	if (pairDate !== todayUtc) {
		return false;
	}
	const currentUtcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
	return currentUtcMinutes < EDITION_WAITING_CUTOFF_UTC_MINUTES;
}

// The actual UTC calendar date `now` falls on - never `maxServableDate(now)`,
// which clamps to EARLIEST_PUBLICATION_DATE when the clock reads before the
// deployment date. That clamp exists to keep the date range non-empty; fed
// into `todayUtc` here it would instead claim a future date is "today" and
// grade a not-found response as merely waiting on it.
function utcCalendarDate(instant: Date): string {
	return instant.toISOString().slice(0, 10);
}

// The waiting cutoff is a wall-clock fact the same way UTC
// midnight is for the date-range rollover in use-edition-date-range.ts: a
// tab left open across it must regrade an already-rendered "waiting" alert
// into "absent" on its own, without the reader touching a control.
function msUntilEditionWaitingCutoff(instant: Date): number {
	const boundaryToday = Date.UTC(
		instant.getUTCFullYear(),
		instant.getUTCMonth(),
		instant.getUTCDate(),
		0,
		EDITION_WAITING_CUTOFF_UTC_MINUTES,
	);
	const nextBoundary = boundaryToday > instant.getTime() ? boundaryToday : boundaryToday + 24 * 60 * 60 * 1000;
	return nextBoundary - instant.getTime();
}

interface EditionAlert {
	outcome: EditionDisplayError;
	// The (region, date) pair the fetch that produced `outcome` actually ran
	// for - captured at request time so a later change to the pending
	// selection can never retroactively regrade an alert already on screen.
	pair: EditionSelection;
}

export function EditionPage() {
	const dateRange = useEditionDateRange();
	const { selection, setSelection } = useEditionSelection(dateRange);
	const [edition, setEdition] = useState<Edition | null>(null);
	const [loading, setLoading] = useState(true);
	const [alert, setAlert] = useState<EditionAlert | null>(null);
	// Exists only to force a re-render when the waiting cutoff
	// crosses on an open tab - `now` is read fresh every render, but nothing
	// else schedules one at all across that boundary.
	const [, forceRerenderAtEditionWaitingCutoff] = useState(0);

	useEffect(() => {
		const controller = new AbortController();
		// Built from the two dependency-listed fields rather than aliasing
		// `selection` itself, so this effect's captured request pair can never
		// drift from what its dependency array actually re-runs on.
		const requestedPair: EditionSelection = {
			activeRegionId: selection.activeRegionId,
			publicationDate: selection.publicationDate,
		};

		void (async () => {
			setLoading(true);
			// Cleared as soon as this fetch starts, not when it resolves - an
			// alert from the previous pair must never linger on screen while a
			// different pair is loading.
			setAlert(null);
			try {
				const outcome = await getEdition({
					activeRegionId: requestedPair.activeRegionId,
					publicationDate: requestedPair.publicationDate,
					signal: controller.signal,
				});
				// getEdition never throws for a cancelled request - it reports the
				// modeled `aborted` outcome instead - so this page's own
				// signal.aborted read is the only thing standing between an abort
				// and it ever reaching setAlert. Checking both keeps that true even
				// if the two ever disagree (for example, an abort a caller other
				// than this effect's cleanup drove).
				if (controller.signal.aborted || outcome.outcome === "aborted") return;
				if (outcome.outcome === "published") {
					setEdition(outcome.edition);
				} else {
					setEdition(null);
					setAlert({ outcome, pair: requestedPair });
				}
			} catch (err) {
				if (controller.signal.aborted) return;
				// getEdition never throws for any expected case, abort included
				// (see its own catch blocks); anything reaching here means it broke
				// its own contract, so it is reported honestly rather than
				// mislabeled as one of the modeled outcomes.
				console.error("EditionPage: getEdition rejected unexpectedly", err);
				setEdition(null);
				setAlert({ outcome: { outcome: "unexpected_error" }, pair: requestedPair });
			} finally {
				if (!controller.signal.aborted) {
					setLoading(false);
				}
			}
		})();

		return () => controller.abort();
	}, [selection.activeRegionId, selection.publicationDate]);

	useEffect(() => {
		if (loading) {
			document.title = "Loading... - BitCraft News";
		} else if (edition) {
			document.title = `Region ${edition.active_region_id} - ${edition.main_story.headline} - BitCraft News`;
		} else {
			document.title = "BitCraft News - Daily Regional Newspaper";
		}
	}, [loading, edition]);

	useEffect(() => {
		let timer: number;
		// Re-armed from inside the callback, mirroring the midnight rollover in
		// use-edition-date-range.ts, so an open tab keeps regrading at every
		// day's boundary rather than only the first one after mount.
		const scheduleBoundary = () => {
			timer = window.setTimeout(() => {
				forceRerenderAtEditionWaitingCutoff((tick) => tick + 1);
				scheduleBoundary();
			}, msUntilEditionWaitingCutoff(new Date()));
		};
		scheduleBoundary();
		return () => window.clearTimeout(timer);
	}, []);

	// One wall-clock read, shared by the today comparison, the waiting
	// determination, and the local generation time it renders when waiting.
	// `utcCalendarDate(now)` - not `maxServableDate(now)` or `dateRange.maxDate`
	// - supplies "today": `maxServableDate` clamps to EARLIEST_PUBLICATION_DATE
	// and would claim a future date is today when the clock reads before it,
	// and `dateRange.maxDate` only advances when the midnight rollover timer
	// fires and can lag the real clock across UTC midnight.
	const now = new Date();
	const isWaiting =
		alert !== null && isWaitingForTodaysEdition(alert.pair.publicationDate, utcCalendarDate(now), now);
	// The full-page spinner covers "no edition is on screen to show" - first
	// load, and any later load that starts with no edition currently
	// rendered (for example, right after a not-found). It never returns once
	// an edition is showing: a subsequent load keeps that edition visible
	// with only the controls bar's inline busy indicator, per criterion 4.
	const showFullPageSpinner = loading && edition === null;

	return (
		<Box bg="surface.base" color="text.primary" minH="100vh">
			<ControlsBar
				selection={selection}
				onSelectionChange={setSelection}
				dateRange={dateRange}
				isBusy={loading}
			/>
			{showFullPageSpinner ? (
				<Flex justify="center" align="center" minH="60vh">
					<Flex direction="column" align="center" gap={4}>
						<Spinner size="xl" color="text.primary" />
						<Text color="text.primary">Loading edition...</Text>
					</Flex>
				</Flex>
			) : (
				<>
					{alert && (
						<Box p={4}>
							<EditionOutcomeAlert
								outcome={alert.outcome}
								isWaitingForTodaysEdition={isWaiting}
								localExpectedAvailabilityTime={isWaiting ? formatLocalExpectedAvailabilityTime(now) : ""}
							/>
						</Box>
					)}
					{edition && <PublishedPaper edition={edition} />}
				</>
			)}
		</Box>
	);
}
