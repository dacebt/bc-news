import type { BenchmarkRun } from "./evaluation-artifact";
import {
	TransportFailureDetailsSchema,
	type TransportFailureDetails,
} from "./evaluation-artifact-schemas";

interface BenchmarkTrackFinding {
	readonly kind: string;
	readonly code: string;
	readonly message: string;
}

interface BenchmarkTrackState {
	readonly findings: readonly BenchmarkTrackFinding[];
}

function trackEntries(
	benchmark: BenchmarkRun,
	trial: BenchmarkRun["trials"][number],
): ReadonlyArray<
	readonly ["main_story" | "announcements", BenchmarkTrackState]
> {
	if (benchmark.version === 9) {
		return [
			["main_story", trial.tracks.main_story],
			["announcements", trial.tracks.announcements],
		];
	}
	return [
		["main_story", trial.tracks.main_story],
		["announcements", trial.tracks.announcements],
	];
}

function runtimeEvidenceCounts(benchmark: BenchmarkRun) {
	if (!("runtime_evidence" in benchmark)) {
		return undefined;
	}
	return benchmark.runtime_evidence.reduce(
		(counts, record) => {
			counts[record.state] += 1;
			return counts;
		},
		{ pending: 0, captured: 0, unavailable: 0 },
	);
}

function contractIssues(details: TransportFailureDetails | undefined): string[] {
	if (details === undefined) {
		return [];
	}
	return details.issues.map((issue) => {
		const issuePath = issue.path.reduce<string>(
			(current, segment) =>
				typeof segment === "number"
					? `${current}[${String(segment)}]`
					: `${current}.${segment}`,
			"$",
		);
		return `Contract issue contract=${details.contract}${details.http_status === undefined ? "" : ` http_status=${String(details.http_status)}`} path=${issuePath} code=${issue.code}${issue.expected === undefined ? "" : ` expected=${issue.expected}`}${issue.received_type === undefined ? "" : ` received_type=${issue.received_type}`}${issue.unexpected_keys === undefined ? "" : ` unexpected_keys=${issue.unexpected_keys.join(",")}`}${issue.provider_code === undefined ? "" : ` provider_code=${issue.provider_code}`}${issue.provider_message === undefined ? "" : ` provider_message=${issue.provider_message}`}`;
	});
}

export function formatBenchmarkRunReport(benchmark: BenchmarkRun, path: string): string {
	const diagnosticCount = benchmark.trials.reduce(
		(count, trial) =>
			count
			+ trackEntries(benchmark, trial).reduce(
				(trackCount, [, track]) => trackCount + track.findings.length,
				0,
			),
		0,
	);
	const diagnostics = benchmark.trials.flatMap((trial, trialIndex) =>
		trackEntries(benchmark, trial).flatMap(([track, state]) =>
			state.findings.map(
				(finding) =>
					`Diagnostic trial=${String(trialIndex + 1)} track=${track} kind=${finding.kind} code=${finding.code}: ${finding.message}`,
			),
		),
	);
	const runtimeEvidence = runtimeEvidenceCounts(benchmark);
	const failures = benchmark.trials.flatMap((trial, trialIndex) => trial.invocations.flatMap((invocation) => {
		if (invocation.transport !== "failed") return [];
		const summary = `Failure trial=${String(trialIndex + 1)} invocation=${String(invocation.ordinal)} step=${invocation.production_step} code=${invocation.failure.code}: ${invocation.failure.message}`;
		const details = TransportFailureDetailsSchema.safeParse(invocation.failure.details);
		const issues = contractIssues(details.success ? details.data : undefined);
		return [summary, ...issues];
	}));
	return [
		`Benchmark Run: ${benchmark.id}`,
		`Evaluation Trials: ${String(benchmark.trials.length)}`,
		`Subject outcomes: ${Object.entries(benchmark.outcome_counts).map(([outcome, count]) => `${outcome}=${String(count)}`).join(", ")}`,
		`Retained diagnostics: ${String(diagnosticCount)}`,
		...(runtimeEvidence === undefined ? [] : [`Runtime evidence: pending=${String(runtimeEvidence.pending)}, captured=${String(runtimeEvidence.captured)}, unavailable=${String(runtimeEvidence.unavailable)}`]),
		...failures,
		...diagnostics,
		`Harness outcome: ${benchmark.harness_outcome}`,
		`Retained artifact: ${path}`,
	].join("\n");
}
