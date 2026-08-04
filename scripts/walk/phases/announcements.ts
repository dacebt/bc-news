import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EditionSchema, EvidenceFixtureSchema, type Announcement, type GenerationRunParams } from "@bc-news/contracts";
import type { WalkContext, WalkPhase } from "../phase";
/*
 * generation-core is not a declared dependency of the workspace root (only
 * @bc-news/contracts is), so it is unreachable via package-name import here —
 * same reason the fixture JSON below is read through a constructed relative
 * path instead of the @bc-news/fixtures package. Reaching into its src by
 * relative path follows that same established walk-script convention rather
 * than introducing a new one.
 */
import { evidenceDateForPublicationDate, prepareEvidence } from "../../../packages/generation-core/src/index";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const RECORDED_ANNOUNCEMENTS_FIXTURE_PATH = join(
	REPO_ROOT,
	"packages",
	"fixtures",
	"model-responses",
	"announcements.json",
);

async function recordedAnnouncementTitles(): Promise<readonly string[]> {
	const raw = await readFile(RECORDED_ANNOUNCEMENTS_FIXTURE_PATH, "utf8");
	const recorded = JSON.parse(raw) as { text: string };
	const parsed = JSON.parse(recorded.text) as { announcements: { title: string }[] };
	return parsed.announcements.map((announcement) => announcement.title);
}

const BOLD_NAME_PATTERN = /\*\*([^*]+)\*\*/g;

/**
 * The announcements prompt contract instructs the model to mark player names
 * with markdown bold ("Use markdown for **player names**"), so bold spans are
 * the mechanical handle this walk phase has on "which player does this
 * announcement name" without reimplementing NLP entity extraction.
 */
function extractNamedPlayers(summary: string): readonly string[] {
	const names = new Set<string>();
	for (const match of summary.matchAll(BOLD_NAME_PATTERN)) {
		const name = match[1]?.trim();
		if (name !== undefined && name.length > 0) {
			names.add(name);
		}
	}
	return [...names];
}

function normalizeName(name: string): string {
	return name.trim().replace(/['’]s$/i, "").toLowerCase();
}

/**
 * Re-derives the PREPARED evidence through the real prepareEvidence
 * pipeline (same function and same pair the generation Workflow uses) rather
 * than reading raw fixture messages directly, so this check is sensitive to
 * sampling: a player whose grounding content gets sampled out of the prompt
 * is no better grounded than a wholly invented one.
 */
async function preparedEvidenceAuthorNames(pair: GenerationRunParams): Promise<readonly string[]> {
	const evidenceDate = evidenceDateForPublicationDate(pair.publication_date);
	const evidenceFixturePath = join(
		REPO_ROOT,
		"packages",
		"fixtures",
		"evidence",
		`active-region-${pair.active_region_id}_${evidenceDate}.json`,
	);
	const raw = await readFile(evidenceFixturePath, "utf8");
	const fixture = EvidenceFixtureSchema.parse(JSON.parse(raw));
	const prepared = prepareEvidence({
		activeRegionId: pair.active_region_id,
		publicationDate: pair.publication_date,
		messages: fixture.messages,
	});
	return prepared.messages.map((message) => message.author_name);
}

/**
 * Closes the tautology the recorded-fixture title comparison above cannot:
 * that check only proves the served edition matches what recordedModelProvider
 * returned, never that what it returned was grounded in evidence at all. Every
 * player an announcement names (per the bold-markdown convention) must appear
 * as an author in the PREPARED evidence actually built for this run.
 */
function assertAnnouncementsGroundedInEvidence(
	announcements: readonly Announcement[],
	preparedAuthorNames: readonly string[],
): void {
	const normalizedAuthorNames = new Set(preparedAuthorNames.map(normalizeName));
	for (const announcement of announcements) {
		const namedPlayers = extractNamedPlayers(announcement.summary);
		if (namedPlayers.length === 0) {
			throw new Error(
				`announcement "${announcement.title}" names no player in bold markdown, so grounding cannot be verified against the prepared evidence`,
			);
		}
		for (const name of namedPlayers) {
			if (!normalizedAuthorNames.has(normalizeName(name))) {
				throw new Error(
					`announcement "${announcement.title}" names player "${name}", who does not appear as an author in the prepared evidence — ungrounded announcement`,
				);
			}
		}
	}
}

async function run(ctx: WalkContext): Promise<void> {
	if (ctx.state.firstServedEditionBody === undefined) {
		throw new Error(
			"announcements phase requires ctx.state.firstServedEditionBody from the publish-poll phase, but it is absent",
		);
	}
	const edition = EditionSchema.parse(JSON.parse(ctx.state.firstServedEditionBody));

	if (edition.announcements.length === 0) {
		throw new Error("served edition announcements array is empty, expected the recorded fixture's announcements");
	}

	const expectedTitles = await recordedAnnouncementTitles();
	const servedTitles = edition.announcements.map((announcement) => announcement.title);
	const titlesMatch =
		servedTitles.length === expectedTitles.length &&
		servedTitles.every((title, index) => title === expectedTitles[index]);
	if (!titlesMatch) {
		throw new Error(
			`served announcement titles ${JSON.stringify(servedTitles)} do not match recorded fixture titles ${JSON.stringify(expectedTitles)} in order`,
		);
	}

	const preparedAuthorNames = await preparedEvidenceAuthorNames(ctx.pair);
	assertAnnouncementsGroundedInEvidence(edition.announcements, preparedAuthorNames);

	console.log(`walk: announcements served in order: ${servedTitles.join(", ")}`);
	console.log("walk: every named player is grounded in the prepared evidence");
}

export const walkPhase: WalkPhase = { name: "announcements", run };
