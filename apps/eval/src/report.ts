import type { RunComparison } from "./compare";
import { JudgeStepSchema, type JudgeStep, type RunFile, type RunFileRead } from "./run-file";

function displayHash(value: string | null): string {
	return value ?? "missing";
}

function displayNumber(value: number | null): string {
	return value === null ? "missing" : String(value);
}

function formatJudgeSummary(judge: JudgeStep | null): string {
	if (judge === null) return "judge: skipped";
	const scores = Object.entries(judge.scores)
		.map(([name, score]) => `${name}=${score}`)
		.join(", ");
	const source = judge.provenance.source === "recorded_replay" ? "recorded judge replay" : "model judgment";
	return `${source} (${judge.weighting}): ${judge.aggregate.toFixed(2)} [${scores}]`;
}

export function formatRunSummary(run: RunFile, outputPath: string): string {
	const lines = [`Saved: ${outputPath}`];
	for (const step of run.steps) {
		const checks = step.checks ?? [];
		const passed = checks.filter((check) => check.passed).length;
		lines.push(`${step.capability}: ${passed}/${checks.length} checks passed; ${formatJudgeSummary(step.judge)}`);
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
		const judge = JudgeStepSchema.nullable().safeParse(step.judge);
		lines.push(formatJudgeSummary(judge.success ? judge.data : null));
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
		lines.push(
			`Judge (${step.judge.weighting ?? "n/a"}): ${displayNumber(step.judge.aggregateLeft)} -> ${displayNumber(step.judge.aggregateRight)}`,
		);
		if (step.judge.rubricMismatch !== null) {
			lines.push(`Judge rubric mismatch: ${step.judge.rubricMismatch}`);
		}
		for (const dimension of step.judge.dimensions) {
			lines.push(
				`- judge:${dimension.name}: ${displayNumber(dimension.left)} -> ${displayNumber(dimension.right)}${dimension.changed ? " (changed)" : ""}`,
			);
		}
	}
	return lines.join("\n");
}
