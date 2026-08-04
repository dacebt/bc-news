import { createHash } from "node:crypto";
import type { RunFileRead } from "./run-file";

export interface CheckComparison {
	readonly name: string;
	readonly left: boolean | null;
	readonly right: boolean | null;
	readonly changed: boolean;
}

export interface StepComparison {
	readonly capability: string;
	readonly presentLeft: boolean;
	readonly presentRight: boolean;
	readonly outputHashLeft: string | null;
	readonly outputHashRight: string | null;
	readonly outputHashEqual: boolean;
	readonly checks: readonly CheckComparison[];
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
