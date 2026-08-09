import {
	announcementsFinalProductDiagnostics,
	mainStoryFinalProductDiagnostics,
	type AnnouncementsProduct,
	type MainStoryProduct,
	type PreparedEvidence,
} from "@bc-news/generation-core";

/** Independently callable deterministic findings for the final main-story product. */
export function findMainStoryFinalProductFailures(
	mainStory: MainStoryProduct,
	preparedEvidence: PreparedEvidence,
): string[] {
	return mainStoryFinalProductDiagnostics(mainStory, preparedEvidence)
		.map((diagnostic) => diagnostic.message);
}

/** Independently callable deterministic findings for the final announcements product. */
export function findAnnouncementsFinalProductFailures(
	announcements: AnnouncementsProduct,
	preparedEvidence: PreparedEvidence,
): string[] {
	return announcementsFinalProductDiagnostics(announcements, preparedEvidence)
		.map((diagnostic) => diagnostic.message);
}
