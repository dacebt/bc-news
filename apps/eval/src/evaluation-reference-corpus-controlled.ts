import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { EvaluationReferenceManifestSchema } from "./evaluation-reference-corpus";
import {
	buildControlledReferenceCorpusFixtures,
	type ControlledReferenceCorpusFixtureDefinition,
} from "./evaluation-reference-corpus-controlled-synthetic";

const CONTROLLED_REFERENCE_CORPUS_ID = "bcn-evaluation-reference-corpus-v2";
const EVALUATION_CORPUS_ROOT = "packages/fixtures/evaluation-corpus";

function evidencePath(id: string): string {
	return `${EVALUATION_CORPUS_ROOT}/evidence/${id}.json`;
}

function referencePath(id: string): string {
	return `${EVALUATION_CORPUS_ROOT}/references/${id}.json`;
}

async function writeJson(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function controlledReferenceCorpusFixtures(): readonly ControlledReferenceCorpusFixtureDefinition[] {
	return buildControlledReferenceCorpusFixtures();
}

export async function writeControlledRepositoryReferenceCorpus(
	repositoryRoot: string,
): Promise<{ manifestPath: string; corpusRoot: string }> {
	const fixtures = buildControlledReferenceCorpusFixtures();
	const corpusRoot = join(repositoryRoot, EVALUATION_CORPUS_ROOT);

	for (const fixture of fixtures) {
		await writeJson(join(repositoryRoot, evidencePath(fixture.id)), fixture.evidence);
		await writeJson(join(repositoryRoot, referencePath(fixture.id)), fixture.reference);
	}

	const manifestPath = join(corpusRoot, "manifest.json");
	await writeJson(manifestPath, EvaluationReferenceManifestSchema.parse({
		version: 2,
		id: CONTROLLED_REFERENCE_CORPUS_ID,
		fixtures: fixtures.map((fixture) => ({
			ordinal: fixture.ordinal,
			id: fixture.id,
			evidence_path: evidencePath(fixture.id),
			reference_path: referencePath(fixture.id),
			variation_tags: [...fixture.variation_tags],
			variation_witnesses: fixture.variation_witnesses.map((witness) => ({
				tag: witness.tag,
				reference_ids: [...witness.reference_ids],
				message_ids: [...witness.message_ids],
			})),
		})),
	}));

	return { manifestPath, corpusRoot };
}
