// Reader-facing expectation inherited from the prior client. Generation starts
// at midnight UTC; this is the later time by which the reader expects today's
// edition to be available, not the Workflow's schedule or publication instant.
export const EXPECTED_EDITION_AVAILABILITY_UTC_MINUTES = 10 * 60;

// An absent current-day edition remains a waiting state for thirty minutes
// after the expected-availability target before the client reports failure.
export const EDITION_WAITING_CUTOFF_UTC_MINUTES = EXPECTED_EDITION_AVAILABILITY_UTC_MINUTES + 30;

// Human-readable UTC label for the publish-time fact above. The alert owns
// the surrounding sentence, but not a second copy of the hour itself.
export function formatUtcExpectedAvailabilityTime(): string {
	const hours = Math.floor(EXPECTED_EDITION_AVAILABILITY_UTC_MINUTES / 60);
	const minutes = EXPECTED_EDITION_AVAILABILITY_UTC_MINUTES % 60;
	const period = hours < 12 ? "AM" : "PM";
	const clockHours = hours % 12 || 12;
	return `${clockHours}:${String(minutes).padStart(2, "0")} ${period} UTC`;
}

// 10:00 AM UTC, formatted in the reader's own zone, for the waiting-edition
// copy. Ported from the deployed v0.1.4 client's formatLocalGenerationTime
// (bc-newspaper src/pages/EditionPage.tsx). Takes `now` rather than reading
// the clock itself - only the reader's UTC offset varies with which instant
// is passed in, and that is fixed for the duration of one render, so the
// caller supplies it once and reuses it across every value derived from that
// render.
export function formatLocalExpectedAvailabilityTime(now: Date): string {
	const expectedAvailabilityTime = new Date(now);
	expectedAvailabilityTime.setUTCHours(
		Math.floor(EXPECTED_EDITION_AVAILABILITY_UTC_MINUTES / 60),
		EXPECTED_EDITION_AVAILABILITY_UTC_MINUTES % 60,
		0,
		0,
	);
	return expectedAvailabilityTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
}
