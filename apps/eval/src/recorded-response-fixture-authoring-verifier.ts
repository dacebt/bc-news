import { isDeepStrictEqual } from "node:util";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import {
	RecordedModelResponseSchema,
	type RecordedModelResponse,
} from "@bc-news/fixtures";
import { CURRENT_PRODUCTION_MODEL_STEPS } from "./current-production-steps";
import { REPRESENTATIVE_FIXTURE_PATH } from "./representative-fixture";
import { recordCommand } from "./record-command";
import {
	startRecordLoopbackServer,
} from "./record-loopback-server";

const MODEL_BY_STEP = {
	main_story_write: "loopback/main-story-write",
	announcements_write: "loopback/announcements-write",
} as const satisfies Record<(typeof CURRENT_PRODUCTION_MODEL_STEPS)[number], string>;

const MAIN_STORY_DRAFT = {
	title: "The Loopback Ledger",
	main_story: {
		headline: "Region 7 Maps a Dependable Route",
		lede: "The region compared routes and coordinated the next expedition.",
		body: "Region 7 discussed the Widmoria route.\n\nAryn mapped the route for the next expedition.",
	},
};

const ANNOUNCEMENTS_DRAFT = {
	announcements: [
		{ title: "Aryn Maps the Route", summary: "Aryn completed a route plan for the next expedition." },
		{ title: "Region Records a Milestone", summary: "The region completed its recording milestone." },
	],
};

const OUTPUT_BY_STEP = {
	main_story_write: JSON.stringify(MAIN_STORY_DRAFT),
	announcements_write: JSON.stringify(ANNOUNCEMENTS_DRAFT),
} as const satisfies Record<(typeof CURRENT_PRODUCTION_MODEL_STEPS)[number], string>;

const RESPONSE_FILENAMES = CURRENT_PRODUCTION_MODEL_STEPS.map((step) => `${step}.json`).sort();

export class RecordedResponseFixtureAuthoringVerificationError extends Error {
	readonly code: string;

	constructor(code: string, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "RecordedResponseFixtureAuthoringVerificationError";
		this.code = code;
	}
}

function assertProof(condition: boolean, code: string, message: string): asserts condition {
	if (!condition) throw new RecordedResponseFixtureAuthoringVerificationError(code, message);
}

function liveConfig() {
	return {
		production_steps: Object.fromEntries(
			CURRENT_PRODUCTION_MODEL_STEPS.map((step) => [
				step,
				{
					adapter: "openai_compatible_hosted",
					provider: "repository_loopback",
					model: MODEL_BY_STEP[step],
					billing: {
						method: "calculated",
						input_usd_per_million_tokens: 0,
						output_usd_per_million_tokens: 0,
						pricing_reference: "repository loopback proof",
					},
				},
			]),
		),
	};
}

async function parseResponse(path: string): Promise<RecordedModelResponse> {
	let candidate: unknown;
	try {
		candidate = JSON.parse(await readFile(path, "utf8")) as unknown;
	} catch (cause) {
		throw new RecordedResponseFixtureAuthoringVerificationError("record_invalid_json", `Recorded response at ${path} is not valid JSON`, { cause });
	}
	const parsed = RecordedModelResponseSchema.safeParse(candidate);
	if (!parsed.success) {
		throw new RecordedResponseFixtureAuthoringVerificationError("record_contract_rejected", `Recorded response at ${path} does not match the strict contract`);
	}
	return parsed.data;
}

async function assertRecordedResponses(responseDirectory: string): Promise<void> {
	const filenames = (await readdir(responseDirectory)).sort();
	assertProof(isDeepStrictEqual(filenames, RESPONSE_FILENAMES), "response_roster_mismatch", "Promoted response directory did not contain exactly the two production response files");
	for (const productionStep of CURRENT_PRODUCTION_MODEL_STEPS) {
		const record = await parseResponse(join(responseDirectory, `${productionStep}.json`));
		assertProof("version" in record && record.version === 3, "record_version_mismatch", `Recorded response for ${productionStep} did not use current artifact version 3`);
		assertProof(record.production_step === productionStep, "record_step_mismatch", `Recorded response for ${productionStep} declared a different production step`);
		assertProof(record.configuration.adapter === "openai_compatible_hosted"
			&& record.configuration.provider === "repository_loopback"
			&& record.configuration.model === MODEL_BY_STEP[productionStep]
			&& record.configuration.temperature === undefined,
		"record_configuration_mismatch",
		`Recorded hosted response for ${productionStep} did not retain its exact agent configuration`);
	}
}

async function assertNoPromotionArtifacts(temporaryRoot: string): Promise<void> {
	const entries = await readdir(temporaryRoot, { recursive: true });
	const promotionArtifact = entries.find((entry) => /(?:^|\/)[^/]*(?:backup|staging|stage|lock)(?:[-.]|$)/iu.test(entry));
	assertProof(promotionArtifact === undefined, "promotion_artifact_remained", `Recording left a backup, staging directory, or lock at ${promotionArtifact ?? "unknown"}`);
}

async function verifyRecordedResponseFixtureAuthoringAt(temporaryRoot: string): Promise<void> {
	await mkdir(temporaryRoot, { recursive: true });
	const configPath = join(temporaryRoot, "record-loopback.config.json");
	const responseDirectory = join(temporaryRoot, "model-responses");
	await writeFile(configPath, `${JSON.stringify(liveConfig(), null, 2)}\n`, "utf8");
	const outputByModel = Object.fromEntries(
		CURRENT_PRODUCTION_MODEL_STEPS.map((step) => [MODEL_BY_STEP[step], OUTPUT_BY_STEP[step]]),
	);
	assertProof(new Set(Object.values(outputByModel)).size === 2, "loopback_outputs_not_distinct", "Loopback proof requires two distinct model outputs");
	const server = await startRecordLoopbackServer(outputByModel);
	try {
		const result = await recordCommand({
			fixturePath: REPRESENTATIVE_FIXTURE_PATH,
			configPath,
			responseDirectory,
			environment: {
				HOSTED_MODEL_BASE_URL: server.baseUrl,
				HOSTED_MODEL_API_KEY: "record-loopback-proof",
			},
		});
		assertProof(resolve(result.responseDirectory) === resolve(responseDirectory), "response_directory_mismatch", "Recorder promoted responses outside the walk-owned response directory");
		assertProof(server.requests.length === CURRENT_PRODUCTION_MODEL_STEPS.length, "request_count_mismatch", "Loopback provider did not observe exactly two requests");
		for (const [index, productionStep] of CURRENT_PRODUCTION_MODEL_STEPS.entries()) {
			assertProof(server.requests[index]?.model === MODEL_BY_STEP[productionStep], "request_order_mismatch", `Loopback request ${index} was not ${productionStep}`);
		}
		await assertRecordedResponses(responseDirectory);
		assertProof(result.comparison.differences.length === 0, "comparison_differences", "Recorded replay reported final editorial-product differences");
		assertProof(isDeepStrictEqual(result.replayProducts, result.liveProducts), "product_mismatch", "Recorded replay products did not structurally equal live products");
		await assertNoPromotionArtifacts(temporaryRoot);
	} finally {
		await server.close();
	}
}

export async function verifyRecordedResponseFixtureAuthoring(temporaryRoot?: string): Promise<void> {
	if (temporaryRoot !== undefined) {
		await verifyRecordedResponseFixtureAuthoringAt(temporaryRoot);
		return;
	}
	const ownedRoot = await mkdtemp(join(tmpdir(), "bc-news-recorded-response-fixture-authoring-"));
	try {
		await verifyRecordedResponseFixtureAuthoringAt(ownedRoot);
	} finally {
		await rm(ownedRoot, { recursive: true, force: true });
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	verifyRecordedResponseFixtureAuthoring().then(() => {
		console.log("fixture authoring: two strict v3 hosted responses retained exact production-step configurations, replayed, and compared");
	}).catch((error: unknown) => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}
