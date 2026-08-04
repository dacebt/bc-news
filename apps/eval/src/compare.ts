import { createHash } from "node:crypto";
import { z } from "zod";
import { CAPABILITY_ROSTER } from "./capability-runners";
import { JudgeStepSchema, type RunFileRead } from "./run-file";
import { rubricDimensionNames } from "./rubrics";

export interface CheckComparison {
	readonly name: string;
	readonly left: boolean | null;
	readonly right: boolean | null;
	readonly changed: boolean;
}

export interface JudgeDimensionComparison {
	readonly name: string;
	readonly left: number | null;
	readonly right: number | null;
	readonly changed: boolean;
}

export interface JudgeComparison {
	readonly weighting: "v1_rubric_weighted_mean" | null;
	readonly aggregateLeft: number | null;
	readonly aggregateRight: number | null;
	readonly dimensions: readonly JudgeDimensionComparison[];
	readonly rubricMismatch: string | null;
}

export interface StepComparison {
	readonly capability: string;
	readonly presentLeft: boolean;
	readonly presentRight: boolean;
	readonly outputHashLeft: string | null;
	readonly outputHashRight: string | null;
	readonly outputHashEqual: boolean;
	readonly checks: readonly CheckComparison[];
	readonly judge: JudgeComparison;
}

export interface FingerprintFieldDiff {
	readonly field: string;
	readonly left: string | null;
	readonly right: string | null;
	readonly changed: boolean;
}

export interface RunComparison {
	readonly leftId: string;
	readonly rightId: string;
	readonly steps: readonly StepComparison[];
	readonly fingerprintFields: readonly FingerprintFieldDiff[];
	readonly codeVersionDegraded: boolean;
}

/** Canonical (sorted-key) JSON so two structurally-equal outputs hash equal regardless of key order. */
function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (value !== null && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
			left.localeCompare(right),
		);
		return Object.fromEntries(entries.map(([key, entryValue]) => [key, canonicalize(entryValue)]));
	}
	return value;
}

function outputHash(output: unknown): string {
	return createHash("sha256").update(JSON.stringify(canonicalize(output))).digest("hex");
}

interface ComparableStep {
	readonly capability: string;
	readonly output?: unknown;
	readonly checks?: readonly { readonly name: string; readonly passed: boolean }[];
	readonly judge?: unknown;
}

function stepsByCapability(run: RunFileRead): Map<string, ComparableStep> {
	return new Map(run.steps.map((step) => [step.capability, step as ComparableStep]));
}

function compareChecks(left: ComparableStep | undefined, right: ComparableStep | undefined): CheckComparison[] {
	const leftChecks = new Map((left?.checks ?? []).map((check) => [check.name, check.passed]));
	const rightChecks = new Map((right?.checks ?? []).map((check) => [check.name, check.passed]));
	const names = [...new Set([...leftChecks.keys(), ...rightChecks.keys()])].sort();
	return names.map((name) => {
		const leftPassed = leftChecks.get(name) ?? null;
		const rightPassed = rightChecks.get(name) ?? null;
		return { name, left: leftPassed, right: rightPassed, changed: leftPassed !== rightPassed };
	});
}

/**
 * A step's judge field is `unknown` on the permissive read path; a value
 * that doesn't parse as a valid judge step (including an older run's plain
 * `null`) degrades to `null` here rather than throwing -- compare must stay
 * usable against every run the read schema accepts, and a judge-less side
 * is a comparison outcome (never a 0), not a comparison failure.
 */
function judgeFromStep(step: ComparableStep | undefined) {
	if (step === undefined) return null;
	const parsed = JudgeStepSchema.nullable().safeParse(step.judge);
	return parsed.success ? parsed.data : null;
}

function judgeScore(
	judge: ReturnType<typeof judgeFromStep>,
	dimensionName: string,
): number | null {
	if (judge === null) return null;
	return Object.entries(judge.scores).find(([name]) => name === dimensionName)?.[1] ?? null;
}

const ComparableCapabilitySchema = z.enum(CAPABILITY_ROSTER);

function judgeDimensionNames(
	capability: string,
	leftJudge: ReturnType<typeof judgeFromStep>,
	rightJudge: ReturnType<typeof judgeFromStep>,
): { readonly names: readonly string[]; readonly rubricMismatch: string | null } {
	if (leftJudge === null && rightJudge === null) return { names: [], rubricMismatch: null };
	const parsedCapability = ComparableCapabilitySchema.safeParse(capability);
	if (parsedCapability.success) {
		return { names: rubricDimensionNames(parsedCapability.data), rubricMismatch: null };
	}
	const names = [
		...new Set([
			...Object.keys(leftJudge?.scores ?? {}),
			...Object.keys(rightJudge?.scores ?? {}),
		]),
	].sort();
	return {
		names,
		rubricMismatch: `Judged historical capability "${capability}" has no current rubric`,
	};
}

function compareJudge(
	capability: string,
	left: ComparableStep | undefined,
	right: ComparableStep | undefined,
): JudgeComparison {
	const leftJudge = judgeFromStep(left);
	const rightJudge = judgeFromStep(right);
	const { names, rubricMismatch } = judgeDimensionNames(capability, leftJudge, rightJudge);
	return {
		weighting: leftJudge?.weighting ?? rightJudge?.weighting ?? null,
		aggregateLeft: leftJudge?.aggregate ?? null,
		aggregateRight: rightJudge?.aggregate ?? null,
		dimensions: names.map((name) => {
			const leftScore = judgeScore(leftJudge, name);
			const rightScore = judgeScore(rightJudge, name);
			return { name, left: leftScore, right: rightScore, changed: leftScore !== rightScore };
		}),
		rubricMismatch,
	};
}

const FINGERPRINT_FIELDS = [
	"provider_params",
	"fixture_sha256",
	"checks_sha256",
	"providers_sha256",
	"rubrics_sha256",
	"schemas_sha256",
	"code_version",
] as const;

/** provider_params is an object, not a string; canonicalize it the same way outputs are hashed so key order never manufactures a false diff. */
function fingerprintFieldValue(run: RunFileRead, field: (typeof FINGERPRINT_FIELDS)[number]): string | null {
	const value = run.fingerprint?.[field];
	if (value === undefined) return null;
	if (field === "provider_params") return JSON.stringify(canonicalize(value));
	return typeof value === "string" ? value : null;
}

function isCodeVersionDegraded(run: RunFileRead): boolean {
	if (run.fingerprint === undefined) return true;
	return run.fingerprint.code_version === null || run.fingerprint.code_version === undefined;
}

export function compareRuns(left: RunFileRead, right: RunFileRead): RunComparison {
	const leftSteps = stepsByCapability(left);
	const rightSteps = stepsByCapability(right);
	const capabilities = [...new Set([...leftSteps.keys(), ...rightSteps.keys()])].sort();

	return {
		leftId: left.id,
		rightId: right.id,
		steps: capabilities.map((capability) => {
			const leftStep = leftSteps.get(capability);
			const rightStep = rightSteps.get(capability);
			const leftHash = leftStep?.output === undefined ? null : outputHash(leftStep.output);
			const rightHash = rightStep?.output === undefined ? null : outputHash(rightStep.output);
			return {
				capability,
				presentLeft: leftStep !== undefined,
				presentRight: rightStep !== undefined,
				outputHashLeft: leftHash,
				outputHashRight: rightHash,
				outputHashEqual: leftHash !== null && leftHash === rightHash,
				checks: compareChecks(leftStep, rightStep),
				judge: compareJudge(capability, leftStep, rightStep),
			};
		}),
		fingerprintFields: FINGERPRINT_FIELDS.map((field) => {
			const leftValue = fingerprintFieldValue(left, field);
			const rightValue = fingerprintFieldValue(right, field);
			return { field, left: leftValue, right: rightValue, changed: leftValue !== rightValue };
		}),
		codeVersionDegraded: isCodeVersionDegraded(left) || isCodeVersionDegraded(right),
	};
}
