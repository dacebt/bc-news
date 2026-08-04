import { useEffect, useMemo, useState } from "react";
import { EARLIEST_PUBLICATION_DATE, maxServableDate, type EditionDateRange } from "./edition-date-range";

// Built from the UTC calendar fields rather than by adding 24 hours, so it
// stays right on the two days a year that are not 24 hours long.
function msUntilNextUtcMidnight(instant: Date): number {
	const nextMidnight = Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate() + 1);
	return nextMidnight - instant.getTime();
}

// The upper bound is a wall-clock fact, so a page that is already open has to
// be told when it moves: read once at import, a tab left open across
// rollover keeps offering yesterday's bound. Every reader takes the range
// from this one piece of state, so the date input's `max` and the arrow
// buttons cannot disagree about where the range ends at the moment it rolls
// over.
export function useEditionDateRange(): EditionDateRange {
	const [maxDate, setMaxDate] = useState(() => maxServableDate(new Date()));

	useEffect(() => {
		let rollover: number;
		// Re-armed from inside the callback rather than by re-running this
		// effect on maxDate: a rollover that produced the same string would
		// leave React free to bail out of the re-render, and an effect keyed on
		// maxDate would then never schedule the following day's timer.
		const scheduleRollover = () => {
			rollover = window.setTimeout(() => {
				setMaxDate(maxServableDate(new Date()));
				scheduleRollover();
			}, msUntilNextUtcMidnight(new Date()));
		};
		scheduleRollover();
		return () => window.clearTimeout(rollover);
	}, []);

	return useMemo(() => ({ minDate: EARLIEST_PUBLICATION_DATE, maxDate }), [maxDate]);
}
