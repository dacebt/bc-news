import type { RunComparison } from "./compare";
import type { RunFile, RunFileRead } from "./run-file";

function displayHash(value: string | null): string {
	return value ?? "missing";
}

export function formatRunSummary(run: RunFile, outputPath: string): string {
	const lines = [`Saved: ${outputPath}`];
	for (const step of run.steps) {
		const checks = step.checks ?? [];
		const passed = checks.filter((check) => check.passed).length;
		lines.push(`${step.capability}: ${passed}/${checks.length} checks passed`);
	}
	return lines.join("\n");
}

export function formatRunListing(runs: readonly RunFileRead[]): string {
	if (runs.length === 0) return "No saved runs.";
	return runs
		.map((run) => {
			const capabilities = run.steps.map((step) => step.capability).join(", ") || "none";
			return `${run.id}  started ${run.started_at ?? "unknown"}  capabilities: ${capabilities}`;
		})
		.join("\n");
}

export function formatRunDetail(run: RunFileRead): string {
	const lines = [
		`Run ${run.id}`,
		`Started: ${run.started_at ?? "unknown"}`,
		`Completed: ${run.completed_at ?? "unknown"}`,
		`Fixture: ${run.fixture?.path ?? "unknown"} (${displayHash(run.fixture?.fixture_sha256 ?? null)})`,
		`Code version: ${run.fingerprint?.code_version ?? "unresolved (degraded identity)"}`,
	];
	for (const step of run.steps) {
		const checks = step.checks ?? [];
		const passed = checks.filter((check) => check.passed).length;
		lines.push("", `${step.capability}`, `Prompt: ${displayHash(step.prompt_sha256 ?? null)}`, `Checks: ${passed}/${checks.length} passed`);
		for (const check of checks) {
			lines.push(`- ${check.name}: ${check.passed ? "pass" : "fail"}${check.detail === undefined ? "" : `; ${check.detail}`}`);
		}
		lines.push("Output:", JSON.stringify(step.output, null, 2));
	}
	return lines.join("\n");
}

export function formatRunComparison(comparison: RunComparison): string {
	const lines = [
		`Compare ${comparison.leftId} -> ${comparison.rightId}`,
		`Code version: ${comparison.codeVersionDegraded ? "unresolved on at least one run (degraded identity)" : "resolved on both runs"}`,
		"",
		"Fingerprint fields:",
	];
	for (const field of comparison.fingerprintFields) {
		lines.push(
			`- ${field.field}: ${field.left ?? "missing"} -> ${field.right ?? "missing"}${field.changed ? " (changed)" : ""}`,
		);
	}
	for (const step of comparison.steps) {
		lines.push(
			"",
			step.capability,
			`Present: ${step.presentLeft ? "yes" : "no"} -> ${step.presentRight ? "yes" : "no"}`,
			`Output hash: ${displayHash(step.outputHashLeft)} -> ${displayHash(step.outputHashRight)}`
				+ ` (${step.outputHashEqual ? "equal" : "changed"})`,
		);
		for (const check of step.checks) {
			const left = check.left === null ? "missing" : check.left ? "pass" : "fail";
			const right = check.right === null ? "missing" : check.right ? "pass" : "fail";
			lines.push(`- ${check.name}: ${left} -> ${right}${check.changed ? " (changed)" : ""}`);
		}
	}
	return lines.join("\n");
}
