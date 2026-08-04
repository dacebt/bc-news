// The single fact every publish-timing computation on the newspaper answers
// to: a new edition publishes daily at 10:00 AM UTC. Both the waiting-alert
// copy's {localTime} and EditionPage's generation-window-end boundary derive
// from this one constant, so the hour never drifts between the two -
// previously a literal baked into EditionOutcomeAlert.tsx's copy and a
// separately-typed UTC-minutes constant in EditionPage.tsx.
export const GENERATION_PUBLISH_UTC_MINUTES = 10 * 60;

// Human-readable UTC label for the publish-time fact above. The alert owns
// the surrounding sentence, but not a second copy of the hour itself.
export function formatUtcPublishTime(): string {
	const hours = Math.floor(GENERATION_PUBLISH_UTC_MINUTES / 60);
	const minutes = GENERATION_PUBLISH_UTC_MINUTES % 60;
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
export function formatLocalPublishTime(now: Date): string {
	const publishTime = new Date(now);
	publishTime.setUTCHours(
		Math.floor(GENERATION_PUBLISH_UTC_MINUTES / 60),
		GENERATION_PUBLISH_UTC_MINUTES % 60,
		0,
		0,
	);
	return publishTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
}
