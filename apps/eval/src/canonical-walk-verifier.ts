import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CAPABILITY_ROSTER } from "./capability-runners";
import { loadConfig } from "./config";
import { runCommand } from "./run-command";
import { RunFileSchema, type RunFile } from "./run-file";

export const CANONICAL_BASELINE_ID = "2026-08-05T02-34-42-437Z";
export const CANONICAL_BASELINE_SHA256 = "c700ff9f04100c8315a71d239bb914ad50da7ca4be49f22e2f84aa7a2194baa1";

const APP_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACE_ROOT = join(APP_DIRECTORY, "..", "..");
export const CANONICAL_BASELINE_PATH = join(
	APP_DIRECTORY,
	"results",
	`${CANONICAL_BASELINE_ID}.json`,
);
const CANONICAL_CONFIG_PATH = join(APP_DIRECTORY, "eval.config.json");
const CANONICAL_FIXTURE_PATH = join(
	WORKSPACE_ROOT,
	"packages",
	"fixtures",
	"evidence",
	"active-region-7_2026-01-24.json",
);

const RECORDED_CONFIG = {
	capabilities: {
		main_story: { adapter: "recorded" },
		announcements: { adapter: "recorded" },
		packaging: { adapter: "recorded" },
	},
	judge: { adapter: "recorded" },
} as const;

const REQUIRED_CHECKS = ["injection", "grounding", "schema", "formatting", "stage_specific"] as const;

interface CanonicalComparableRun {
	readonly config: RunFile["config"];
	readonly fixture: RunFile["fixture"];
	readonly steps: RunFile["steps"];
	readonly fingerprint: Omit<RunFile["fingerprint"], "code_version">;
}

function hashBytes(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function parseStrictRun(bytes: Uint8Array, source: string): RunFile {
	let candidate: unknown;
	try {
		candidate = JSON.parse(Buffer.from(bytes).toString("utf8"));
	} catch (cause) {
		throw new Error(`${source} is not valid JSON`, { cause });
	}
	const parsed = RunFileSchema.safeParse(candidate);
	if (!parsed.success) {
		throw new Error(`${source} does not match the strict run contract: ${parsed.error.message}`);
	}
	return parsed.data;
}

function comparableRun(run: RunFile): CanonicalComparableRun {
	return {
		config: run.config,
		fixture: run.fixture,
		steps: run.steps,
		fingerprint: {
			provider_params: run.fingerprint.provider_params,
			fixture_sha256: run.fingerprint.fixture_sha256,
			checks_sha256: run.fingerprint.checks_sha256,
			providers_sha256: run.fingerprint.providers_sha256,
			rubrics_sha256: run.fingerprint.rubrics_sha256,
			schemas_sha256: run.fingerprint.schemas_sha256,
		},
	};
}

function firstDifference(left: unknown, right: unknown, path = "run"): string | null {
	if (Object.is(left, right)) return null;
	if (Array.isArray(left) && Array.isArray(right)) {
		if (left.length !== right.length) return `${path}.length`;
		for (let index = 0; index < left.length; index++) {
			const difference = firstDifference(left[index], right[index], `${path}[${String(index)}]`);
			if (difference !== null) return difference;
		}
		return null;
	}
	if (
		typeof left === "object" && left !== null && !Array.isArray(left)
		&& typeof right === "object" && right !== null && !Array.isArray(right)
	) {
		const leftRecord = left as Record<string, unknown>;
		const rightRecord = right as Record<string, unknown>;
		const keys = [...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])].sort();
		for (const key of keys) {
			if (!Object.hasOwn(leftRecord, key) || !Object.hasOwn(rightRecord, key)) return `${path}.${key}`;
			const difference = firstDifference(leftRecord[key], rightRecord[key], `${path}.${key}`);
			if (difference !== null) return difference;
		}
		return null;
	}
	return path;
}

export function assertCanonicalEvalParity(baseline: RunFile, candidate: RunFile): void {
	const difference = firstDifference(comparableRun(baseline), comparableRun(candidate));
	if (difference !== null) {
		throw new Error(`canonical eval replay drifted at ${difference}`);
	}
}

function assertRecordedConfig(config: RunFile["config"]): void {
	if (JSON.stringify(config) !== JSON.stringify(RECORDED_CONFIG)) {
		throw new Error("canonical eval config must select recorded adapters for all three capabilities and judge");
	}
}

export function assertCanonicalEvalSemantics(run: RunFile, source = "canonical eval run"): void {
	assertRecordedConfig(run.config);
	const roster = run.steps.map((step) => step.capability);
	if (roster.length !== CAPABILITY_ROSTER.length || roster.some((capability, index) => capability !== CAPABILITY_ROSTER[index])) {
		throw new Error(`${source} must contain the exact ordered capability roster`);
	}

	const usages: RunFile["steps"][number]["model_usage"][] = [];
	for (const step of run.steps) {
		if (!step.schema_valid) throw new Error(`${source} ${step.capability} schema result is not green`);
		const checks = step.checks ?? [];
		if (
			checks.length !== REQUIRED_CHECKS.length
			|| REQUIRED_CHECKS.some((name) => checks.filter((check) => check.name === name).length !== 1)
		) {
			throw new Error(`${source} ${step.capability} does not contain every required check exactly once`);
		}
		const redCheck = checks.find((check) => !check.passed);
		if (redCheck !== undefined) {
			throw new Error(`${source} ${step.capability} check ${redCheck.name} is red`);
		}
		if (step.judge === null) throw new Error(`${source} ${step.capability} has no judge result`);
		usages.push(step.model_usage, step.judge.model_usage);
	}

	if (usages.length !== 6) throw new Error(`${source} must contain exactly six model usage records`);
	for (const usage of usages) {
		if (
			usage.provider !== "recorded"
			|| usage.execution !== "recorded_replay"
			|| usage.token_usage.measurement !== "unavailable"
			|| usage.external_billing.classification !== "none"
			|| usage.external_billing.amount_usd !== 0
			|| usage.external_billing.reason !== "recorded_replay"
		) {
			throw new Error(`${source} ${usage.editorial_capability} contains non-recorded usage semantics`);
		}
	}
}

export async function verifyCanonicalEvalReplay(resultsDirectory: string): Promise<void> {
	const config = await loadConfig(CANONICAL_CONFIG_PATH);
	assertRecordedConfig(config);

	const baselineBytes = await readFile(CANONICAL_BASELINE_PATH);
	const baselineHash = hashBytes(baselineBytes);
	if (baselineHash !== CANONICAL_BASELINE_SHA256) {
		throw new Error(
			`canonical baseline hash mismatch: expected ${CANONICAL_BASELINE_SHA256}, got ${baselineHash}`,
		);
	}
	const baseline = parseStrictRun(baselineBytes, CANONICAL_BASELINE_PATH);
	if (baseline.id !== CANONICAL_BASELINE_ID) {
		throw new Error(`canonical baseline id mismatch: expected ${CANONICAL_BASELINE_ID}, got ${baseline.id}`);
	}
	assertRecordedConfig(baseline.config);
	assertCanonicalEvalSemantics(baseline, "canonical baseline");

	const saved = await runCommand({
		fixturePath: CANONICAL_FIXTURE_PATH,
		configPath: CANONICAL_CONFIG_PATH,
		resultsDirectory,
		noJudge: false,
		environment: {},
	});
	const candidateBytes = await readFile(saved.path);
	const candidate = parseStrictRun(candidateBytes, saved.path);
	assertCanonicalEvalSemantics(candidate, "canonical candidate");
	assertCanonicalEvalParity(baseline, candidate);
	console.log(
		`walk: canonical eval replay matches ${CANONICAL_BASELINE_ID} (${CANONICAL_BASELINE_SHA256})`,
	);
}
