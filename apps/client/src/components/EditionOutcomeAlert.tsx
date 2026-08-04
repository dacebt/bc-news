import type { ReactNode } from "react";
import { Alert, AlertIcon, Box } from "@chakra-ui/react";
import type { EditionFetchOutcome } from "../api/edition";
import { formatUtcPublishTime } from "../dates/publish-time";

// Every non-published outcome getEdition can produce except `aborted` (a
// cancelled request never reaches this component - EditionPage filters it
// out before calling setAlert), plus one local-only case: something other
// than getEdition threw during the fetch effect, which is a bug rather than
// a modeled fetch outcome, reported honestly instead of mislabeling it as one
// of the typed cases below.
export type EditionDisplayError =
	| Exclude<EditionFetchOutcome, { outcome: "published" } | { outcome: "aborted" }>
	| { outcome: "unexpected_error" };

interface EditionOutcomeAlertProps {
	outcome: EditionDisplayError;
	isWaitingForTodaysEdition: boolean;
	localGenerationTime: string;
}

// Static, single-sentence messages for the outcomes that don't need any
// per-render data beyond the outcome itself. 'absent' (depends on
// isWaitingForTodaysEdition/localGenerationTime) and 'service_error'
// (depends on the HTTP status) render distinct structured content instead
// and are handled directly in the switch below.
const STATIC_MESSAGES: Record<
	Exclude<EditionDisplayError["outcome"], "absent" | "service_error">,
	string
> = {
	invalid_request: "This request was invalid. Try a different region or date.",
	network_error: "Could not reach the news service. Check your connection and try again.",
	// Names the client-side cause (misconfiguration/misrouting) rather than
	// blaming the service - a 2xx that isn't JSON never reached the
	// generation Worker.
	misrouted_response:
		"This request did not reach the news service as expected — check the site's configuration and try again.",
	invalid_response: "The news service returned data in an unexpected format.",
	unexpected_error: "Something went wrong loading this edition.",
};

// Renders the diagnostic message for one non-published fetch outcome.
// Genuine absence and actual operational failures use different Alert
// statuses so the distinction is visible, not just present in the text.
export function EditionOutcomeAlert({
	outcome,
	isWaitingForTodaysEdition,
	localGenerationTime,
}: EditionOutcomeAlertProps) {
	let status: "info" | "error";
	let content: ReactNode;

	switch (outcome.outcome) {
		case "absent":
			status = isWaitingForTodaysEdition ? "info" : "error";
			content = isWaitingForTodaysEdition ? (
				<Box>
					No edition published for this region for today's date. A new edition is published daily
					at {formatUtcPublishTime()} ({localGenerationTime} your time). Check back later or select
					a previous date to view past editions!
				</Box>
			) : (
				<Box>No published edition for this region/date.</Box>
			);
			break;
		case "service_error":
			status = "error";
			content = (
				<Box>The news service returned an error (HTTP {outcome.httpStatus}). Try again shortly.</Box>
			);
			break;
		case "invalid_request":
		case "network_error":
		case "misrouted_response":
		case "invalid_response":
		case "unexpected_error":
			status = "error";
			content = <Box>{STATIC_MESSAGES[outcome.outcome]}</Box>;
			break;
		default: {
			// Exhaustiveness guard: adding a new EditionFetchOutcome variant
			// without a case above fails this compile, naming the missing
			// variant, instead of silently rendering nothing with a green build.
			const _exhaustive: never = outcome;
			return _exhaustive;
		}
	}

	return (
		<Alert status={status} borderRadius="md" mb={4}>
			<AlertIcon />
			{content}
		</Alert>
	);
}
