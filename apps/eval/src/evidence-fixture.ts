import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { EvidenceFixtureSchema, type EvidenceFixture } from "@bc-news/contracts";
import { evidenceDateForPublicationDate } from "@bc-news/generation-core";
import { REPRESENTATIVE_FIXTURE_FILENAME } from "./representative-fixture";

export class EvalFixtureError extends Error {
	readonly code:
		| "invalid_json"
		| "fixture_rejected"
		| "publication_date_derivation_mismatch"
		| "fixture_directory_ambiguous";
	readonly path: string;

	constructor(
		code: EvalFixtureError["code"],
		path: string,
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "EvalFixtureError";
		this.code = code;
		this.path = path;
	}
}

export interface LoadedFixture {
	readonly path: string;
	readonly bytes: Uint8Array;
	readonly fixtureSha256: string;
	readonly fixture: EvidenceFixture;
	readonly publicationDate: string;
}

/**
 * The evidence-date-to-publication-date relationship is owned by
 * evidenceDateForPublicationDate in generation-core (day-before contract);
 * this is its mechanical inverse (day-after), needed because the fixture
 * carries evidence_date but prepareEvidence takes publicationDate. The
 * candidate is verified by round-tripping it through the real core function
 * rather than trusted on its own, so this can never silently drift from the
 * one authoritative rule.
 */
function publicationDateForEvidenceDate(evidenceDate: string): string {
	const [year, month, day] = evidenceDate.split("-").map(Number);
	const shifted = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + 1));
	const candidate = [
		shifted.getUTCFullYear().toString().padStart(4, "0"),
		(shifted.getUTCMonth() + 1).toString().padStart(2, "0"),
		shifted.getUTCDate().toString().padStart(2, "0"),
	].join("-");
	const derived = evidenceDateForPublicationDate(candidate);
	if (derived !== evidenceDate) {
		throw new EvalFixtureError(
			"publication_date_derivation_mismatch",
			evidenceDate,
			`Derived publication date "${candidate}" round-trips to evidence date "${derived}", not "${evidenceDate}"`,
		);
	}
	return candidate;
}

/**
 * `--fixture` may name either a specific evidence file or the fixture corpus
 * package root (`packages/fixtures`). The package-root shorthand continues to
 * mean the historical representative fixture used by existing replay and
 * context proofs; any additional committed fixtures must be addressed by their
 * explicit file paths so the caller cannot silently consume the wrong evidence.
 */
async function resolveFixtureFile(path: string): Promise<string> {
	const info = await stat(path);
	if (!info.isDirectory()) return path;
	const evidenceDirectory = join(path, "evidence");
	const entries = (await readdir(evidenceDirectory)).filter((name) => name.endsWith(".json"));
	const [only] = entries;
	if (only !== undefined && entries.length === 1) {
		return join(evidenceDirectory, only);
	}
	if (entries.includes(REPRESENTATIVE_FIXTURE_FILENAME)) {
		return join(evidenceDirectory, REPRESENTATIVE_FIXTURE_FILENAME);
	}
	if (only === undefined) {
		throw new EvalFixtureError(
			"fixture_directory_ambiguous",
			path,
			`Expected at least one evidence JSON file under ${evidenceDirectory}, found ${entries.length}`,
		);
	}
	throw new EvalFixtureError(
		"fixture_directory_ambiguous",
		path,
		`Explicit fixture path required when ${evidenceDirectory} contains ${entries.length} evidence files without ${REPRESENTATIVE_FIXTURE_FILENAME}`,
	);
}

export async function loadFixture(path: string): Promise<LoadedFixture> {
	const filePath = await resolveFixtureFile(path);
	const bytes = await readFile(filePath);
	const fixtureSha256 = createHash("sha256").update(bytes).digest("hex");
	let candidate: unknown;
	try {
		candidate = JSON.parse(bytes.toString("utf8"));
	} catch (cause) {
		throw new EvalFixtureError("invalid_json", filePath, `Fixture at ${filePath} is not valid JSON`, { cause });
	}
	const result = EvidenceFixtureSchema.safeParse(candidate);
	if (!result.success) {
		throw new EvalFixtureError(
			"fixture_rejected",
			filePath,
			`Fixture at ${filePath} does not match the evidence fixture contract: ${result.error.message}`,
		);
	}
	return {
		path,
		bytes,
		fixtureSha256,
		fixture: result.data,
		publicationDate: publicationDateForEvidenceDate(result.data.evidence_date),
	};
}
