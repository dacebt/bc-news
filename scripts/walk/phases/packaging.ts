import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EditionSchema } from "@bc-news/contracts";
import type { WalkContext, WalkPhase } from "../phase";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const RECORDED_PACKAGING_FIXTURE_PATH = join(
	REPO_ROOT,
	"packages",
	"fixtures",
	"model-responses",
	"packaging.json",
);

async function recordedPackagingOutput(): Promise<{ title: string; subtitle: string }> {
	const raw = await readFile(RECORDED_PACKAGING_FIXTURE_PATH, "utf8");
	const recorded = JSON.parse(raw) as { text: string };
	return JSON.parse(recorded.text) as { title: string; subtitle: string };
}

async function run(ctx: WalkContext): Promise<void> {
	if (ctx.state.firstServedEditionBody === undefined) {
		throw new Error(
			"packaging phase requires ctx.state.firstServedEditionBody from the publish-poll phase, but it is absent",
		);
	}
	const edition = EditionSchema.parse(JSON.parse(ctx.state.firstServedEditionBody));
	const expected = await recordedPackagingOutput();

	if (edition.title !== expected.title) {
		throw new Error(
			`served edition title ${JSON.stringify(edition.title)} is not byte-equal to the recorded packaging fixture title ${JSON.stringify(expected.title)}`,
		);
	}
	if (edition.subtitle !== expected.subtitle) {
		throw new Error(
			`served edition subtitle ${JSON.stringify(edition.subtitle)} is not byte-equal to the recorded packaging fixture subtitle ${JSON.stringify(expected.subtitle)}`,
		);
	}

	console.log(`walk: packaging title/subtitle served byte-equal to the recorded fixture: "${edition.title}" / "${edition.subtitle}"`);
}

export const walkPhase: WalkPhase = { name: "packaging", run };
