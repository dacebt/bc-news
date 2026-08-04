import type { ReactNode } from "react";
import { Alert, AlertIcon, Box } from "@chakra-ui/react";
import type { EditionFetchOutcome } from "../api/edition";

// Every non-success outcome getEdition can produce, plus one local-only case:
// getEdition rejects with AbortError and nothing else (see its own catch
// blocks), and an abort landing after getEdition has already resolved
// resolves normally instead - the page's own signal.aborted check, not
// getEdition's catch block, handles that case. So this page should never
// observe anything but AbortError from a rejected getEdition call. If it
// does, that is a bug rather than a modeled fetch outcome - report it
// honestly instead of mislabeling it as one of the typed cases below.
export type EditionDisplayError =
	| Exclude<EditionFetchOutcome, { status: "success" }>
	| { status: "unexpected-error" };

interface EditionOutcomeAlertProps {
	outcome: EditionDisplayError;
	isWaitingForTodaysEdition: boolean;
	localGenerationTime: string;
}

// Static, single-sentence messages for the outcomes that don't need any
// per-render data beyond the outcome itself. 'not-found' (depends on
// isWaitingForTodaysEdition/localGenerationTime) and 'service-error'
// (depends on the HTTP status) render distinct structured content instead
// and are handled directly in the switch below.
const STATIC_MESSAGES: Record<
	Exclude<EditionDisplayError["status"], "not-found" | "service-error">,
	string
> = {
	"invalid-request": "This request was invalid. Try a different region or date.",
	"network-error": "Could not reach the news service. Check your connection and try again.",
	// Names the client-side cause (misconfiguration/misrouting) rather than
	// blaming the service - a 2xx that isn't JSON never reached the
	// generation Worker.
	"misrouted-response":
		"This request did not reach the news service as expected — check the site's configuration and try again.",
	"invalid-response": "The news service returned data in an unexpected format.",
	"unexpected-error": "Something went wrong loading this edition.",
};

// Renders the diagnostic message for one non-success fetch outcome. Genuine
// absence (not-found) and actual operational failures use different Alert
// statuses so the distinction is visible, not just present in the text.
export function EditionOutcomeAlert({
	outcome,
	isWaitingForTodaysEdition,
	localGenerationTime,
}: EditionOutcomeAlertProps) {
	let status: "info" | "warning" | "error";
	let content: ReactNode;

	switch (outcome.status) {
		case "not-found":
			status = isWaitingForTodaysEdition ? "info" : "warning";
			content = isWaitingForTodaysEdition ? (
				<Box>
					No edition published for this region for today's date. A new edition is published daily
					at 10:00 AM UTC ({localGenerationTime} your time). Check back later or select a previous
					date to view past editions!
				</Box>
			) : (
				<Box>No published edition for this region/date.</Box>
			);
			break;
		case "service-error":
			status = "error";
			content = (
				<Box>The news service returned an error (HTTP {outcome.httpStatus}). Try again shortly.</Box>
			);
			break;
		case "invalid-request":
		case "network-error":
		case "misrouted-response":
		case "invalid-response":
		case "unexpected-error":
			status = "error";
			content = <Box>{STATIC_MESSAGES[outcome.status]}</Box>;
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
